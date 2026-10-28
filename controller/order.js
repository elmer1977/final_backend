const express = require("express");
const router = express.Router();
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isSeller, isAdmin } = require("../middleware/auth");
const Order = require("../model/order");
const Shop = require("../model/shop");
const User = require("../model/user");
const Product = require("../model/product");
const Event = require("../model/event");
const { sendPushNotification } = require("../utils/pushNotify");
const { getOrderPricing } = require("../utils/orderPricing");

// create new order
router.post(
  "/create-order",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { cart, shippingAddress, user, paymentInfo } = req.body;
      const pricing = await getOrderPricing(cart);

      //   group cart items by shopId
      const shopItemsMap = new Map();

      for (const item of pricing.cart) {
        const shopId = item.shopId;
        if (!shopItemsMap.has(shopId)) {
          shopItemsMap.set(shopId, []);
        }
        shopItemsMap.get(shopId).push(item);
      }

      // create an order for each shop
      const orders = [];
      const reservedStock = [];

      try {
        for (const [shopId, items] of shopItemsMap) {
          for (const item of items) {
            const InventoryModel = item.isEvent ? Event : Product;
            const product = await InventoryModel.findOneAndUpdate(
              { _id: item._id, stock: { $gte: item.qty } },
              { $inc: { stock: -item.qty, sold_out: item.qty } },
              { new: true }
            );

            if (!product) {
              throw new Error(
                `${item.name || "A product"} does not have enough stock available`
              );
            }

            reservedStock.push({
              productId: item._id,
              quantity: item.qty,
              isEvent: item.isEvent,
            });
          }
        }

        for (const [shopId, items] of shopItemsMap) {
          const order = await Order.create({
            cart: items,
            shippingAddress,
            user,
            totalPrice: pricing.shopTotals[shopId],
            currency: "PHP",
            paymentInfo,
            status: "Pending",
          });
          orders.push(order);

          const shop = await Shop.findById(shopId);
          if (shop?.pushSubscription) {
            await sendPushNotification(shop.pushSubscription, {
              title: "New order received",
              body: `You have a new order from ${user?.name || "a customer"}`,
              url: "/dashboard-orders",
              orderId: order._id,
            });
          }
        }
      } catch (error) {
        if (orders.length) {
          await Order.deleteMany({
            _id: { $in: orders.map((order) => order._id) },
          });
        }
        await Promise.all(
          reservedStock.map(({ productId, quantity, isEvent }) => {
            const InventoryModel = isEvent ? Event : Product;
            return InventoryModel.findByIdAndUpdate(productId, {
              $inc: { stock: quantity, sold_out: -quantity },
            });
          })
        );
        throw error;
      }

      res.status(201).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(
        error.statusCode
          ? error
          : new ErrorHandler(error.message, 500)
      );
    }
  })
);

// get all orders of user
router.get(
  "/get-all-orders/:userId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const orders = await Order.find({ "user._id": req.params.userId }).sort({
        createdAt: -1,
      });

      res.status(200).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// get all orders of seller
router.get(
  "/get-seller-all-orders/:shopId",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const orders = await Order.find({
        "cart.shopId": req.params.shopId,
      }).sort({
        createdAt: -1,
      });

      res.status(200).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// update order status for seller    ---------------(product)
router.put(
  "/update-order-status/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const allowedStatuses = [
        "Pending",
        "Processing",
        "Transferred to delivery partner",
        "Shipping",
        "Received",
        "On the way",
        "Delivered",
      ];
      if (!allowedStatuses.includes(req.body.status)) {
        return next(new ErrorHandler("Invalid order status", 400));
      }

      const existingOrder = await Order.findOne({
        _id: req.params.id,
        "cart.shopId": req.seller._id,
      });

      if (!existingOrder) {
        return next(new ErrorHandler("Order not found for this shop", 404));
      }

      if (
        ["Cancelled", "Processing refund", "Refund Success"].includes(
          existingOrder.status
        )
      ) {
        return next(new ErrorHandler("This order can no longer be updated", 400));
      }

      const currentStatusIndex = allowedStatuses.indexOf(existingOrder.status);
      const requestedStatusIndex = allowedStatuses.indexOf(req.body.status);
      if (
        currentStatusIndex !== -1 &&
        requestedStatusIndex < currentStatusIndex
      ) {
        return next(new ErrorHandler("Order status cannot move backwards", 400));
      }

      const statusUpdate = { status: req.body.status };
      if (req.body.status === "Delivered") {
        statusUpdate.deliveredAt = Date.now();
        statusUpdate["paymentInfo.status"] = "Succeeded";
      }

      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: existingOrder._id,
          "cart.shopId": req.seller._id,
          status: existingOrder.status,
        },
        { $set: statusUpdate },
        { new: true }
      );

      if (!updatedOrder) {
        return next(
          new ErrorHandler("Order status changed. Refresh and try again.", 409)
        );
      }

      const userToNotify = await User.findById(updatedOrder.user._id);

      if (req.body.status === "Delivered") {
        const serviceCharge = updatedOrder.totalPrice * 0.1;
        await updateSellerInfo(updatedOrder.totalPrice - serviceCharge);
      }

      if (userToNotify?.pushSubscription) {
        await sendPushNotification(userToNotify.pushSubscription, {
          title: "Order status updated",
          body: `Your order ${updatedOrder._id} is now ${updatedOrder.status}`,
          url: `/user/order/${updatedOrder._id}`,
          orderId: updatedOrder._id,
        });
      }

      res.status(200).json({
        success: true,
        order: updatedOrder,
      });

      async function updateSellerInfo(amount) {
        const seller = await Shop.findById(req.seller.id);
        if (!seller) {
          throw new ErrorHandler("Seller not found", 404);
        }
        seller.availableBalance = amount;
        await seller.save();
      }
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// cancel an order before it is on the way
router.put(
  "/cancel-order/:id",
  isAuthenticated,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findOne({
        _id: req.params.id,
        "user._id": req.user._id,
      });

      if (!order) {
        return next(new ErrorHandler("Order not found", 404));
      }

      const cancellableStatuses = [
        "Pending",
        "Processing",
        "Transferred to delivery partner",
        "Shipping",
        "Received",
      ];
      if (!cancellableStatuses.includes(order.status)) {
        return next(
          new ErrorHandler(
            "This order can no longer be cancelled because it is already on the way or completed",
            400
          )
        );
      }

      const cancelledOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          "user._id": req.user._id,
          status: order.status,
        },
        { $set: { status: "Cancelled" } },
        { new: true }
      );

      if (!cancelledOrder) {
        return next(
          new ErrorHandler("Order status changed. Refresh and try again.", 409)
        );
      }

      const quantitiesByProduct = new Map();
      for (const item of cancelledOrder.cart) {
        const productId = item._id.toString();
        const isEvent = item.isEvent || Boolean(item.start_Date);
        const key = `${isEvent ? "event" : "product"}:${productId}`;
        const existing = quantitiesByProduct.get(key);
        quantitiesByProduct.set(key, {
          productId,
          isEvent,
          quantity: (existing?.quantity || 0) + Number(item.qty),
        });
      }

      const restoredProducts = [];
      try {
        for (const { productId, isEvent, quantity } of quantitiesByProduct.values()) {
          const InventoryModel = isEvent ? Event : Product;
          const product = await InventoryModel.findByIdAndUpdate(
            productId,
            {
              $inc: {
                stock: quantity,
                sold_out: -quantity,
              },
            },
            { new: true }
          );
          if (!product) {
            throw new Error(`Product ${productId} was not found while restoring stock`);
          }
          restoredProducts.push({ productId, quantity, isEvent });
        }
      } catch (error) {
        for (const { productId, quantity, isEvent } of restoredProducts) {
          const InventoryModel = isEvent ? Event : Product;
          await InventoryModel.findByIdAndUpdate(productId, {
            $inc: { stock: -quantity, sold_out: quantity },
          });
        }
        await Order.findOneAndUpdate(
          { _id: cancelledOrder._id, status: "Cancelled" },
          { $set: { status: order.status } }
        );
        throw error;
      }

      try {
        const shops = await Shop.find({
          _id: { $in: cancelledOrder.cart.map((item) => item.shopId) },
        });
        await Promise.all(
          shops
            .filter((shop) => shop.pushSubscription)
            .map((shop) =>
              sendPushNotification(shop.pushSubscription, {
                title: "Order cancelled",
                body: `A customer cancelled order ${cancelledOrder._id}`,
                url: "/dashboard-orders",
                orderId: cancelledOrder._id,
              })
            )
        );
      } catch (notificationError) {
        console.error("Order cancellation notification failed", notificationError);
      }

      res.status(200).json({
        success: true,
        order: cancelledOrder,
        message:
          "Order cancelled and stock restored. Any payment refund will be handled separately.",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// give a refund ----- user
router.put(
  "/order-refund/:id",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id);

      if (!order) {
        return next(new ErrorHandler("Order not found with this id", 400));
      }

      order.status = req.body.status;

      await order.save({ validateBeforeSave: false });

      const userToNotify = await User.findById(order.user._id);
      if (userToNotify?.pushSubscription) {
        await sendPushNotification(userToNotify.pushSubscription, {
          title: "Refund requested",
          body: `Refund requested for order ${order._id}`,
          url: `/user/order/${order._id}`,
          orderId: order._id,
        });
      }

      res.status(200).json({
        success: true,
        order,
        message: "Order Refund Request successfully!",
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// accept the refund ---- seller
router.put(
  "/order-refund-success/:id",
  isSeller,
  catchAsyncErrors(async (req, res, next) => {
    try {
      const order = await Order.findById(req.params.id);

      if (!order) {
        return next(new ErrorHandler("Order not found with this id", 400));
      }

      order.status = req.body.status;

      await order.save();

      const userToNotify = await User.findById(order.user._id);
      if (userToNotify?.pushSubscription) {
        await sendPushNotification(userToNotify.pushSubscription, {
          title: "Refund successful",
          body: `Refund completed for order ${order._id}`,
          url: `/user/order/${order._id}`,
          orderId: order._id,
        });
      }

      res.status(200).json({
        success: true,
        message: "Order Refund successfull!",
      });

      if (req.body.status === "Refund Success") {
        order.cart.forEach(async (o) => {
          await updateOrder(o._id, o.qty);
        });
      }

      async function updateOrder(id, qty) {
        const product = await Product.findById(id);

        product.stock += qty;
        product.sold_out -= qty;

        await product.save({ validateBeforeSave: false });
      }
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

// all orders --- for admin
router.get(
  "/admin-all-orders",
  isAuthenticated,
  isAdmin("Admin"),
  catchAsyncErrors(async (req, res, next) => {
    try {
      const orders = await Order.find().sort({
        deliveredAt: -1,
        createdAt: -1,
      });
      res.status(201).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
    }
  })
);

module.exports = router;
