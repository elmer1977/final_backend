const express = require("express");
const router = express.Router();
const ErrorHandler = require("../utils/ErrorHandler");
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const { isAuthenticated, isSeller, isAdmin } = require("../middleware/auth");
const Order = require("../model/order");
const Shop = require("../model/shop");
const User = require("../model/user");
const Product = require("../model/product");
const { sendPushNotification } = require("../utils/pushNotify");

// create new order
router.post(
  "/create-order",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const { cart, shippingAddress, user, totalPrice, paymentInfo } = req.body;

      //   group cart items by shopId
      const shopItemsMap = new Map();

      for (const item of cart) {
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
            const product = await Product.findOneAndUpdate(
              { _id: item._id, stock: { $gte: item.qty } },
              { $inc: { stock: -item.qty, sold_out: item.qty } },
              { new: true }
            );

            if (!product) {
              throw new Error(
                `${item.name || "A product"} does not have enough stock available`
              );
            }

            reservedStock.push({ productId: item._id, quantity: item.qty });
          }
        }

        for (const [shopId, items] of shopItemsMap) {
          const order = await Order.create({
            cart: items,
            shippingAddress,
            user,
            totalPrice,
            paymentInfo,
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
          reservedStock.map(({ productId, quantity }) =>
            Product.findByIdAndUpdate(productId, {
              $inc: { stock: quantity, sold_out: -quantity },
            })
          )
        );
        throw error;
      }

      res.status(201).json({
        success: true,
        orders,
      });
    } catch (error) {
      return next(new ErrorHandler(error.message, 500));
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
      const order = await Order.findById(req.params.id);

      if (!order) {
        return next(new ErrorHandler("Order not found with this id", 400));
      }

      const userToNotify = await User.findById(order.user._id);

      order.status = req.body.status;

      if (req.body.status === "Delivered") {
        order.deliveredAt = Date.now();
        order.paymentInfo.status = "Succeeded";
        const serviceCharge = order.totalPrice * 0.1;
        await updateSellerInfo(order.totalPrice - serviceCharge);
      }

      await order.save({ validateBeforeSave: false });

      if (userToNotify?.pushSubscription) {
        await sendPushNotification(userToNotify.pushSubscription, {
          title: "Order status updated",
          body: `Your order ${order._id} is now ${order.status}`,
          url: `/user/order/${order._id}`,
          orderId: order._id,
        });
      }

      res.status(200).json({
        success: true,
        order,
      });

      async function updateSellerInfo(amount) {
        const seller = await Shop.findById(req.seller.id);

        seller.availableBalance = amount;

        await seller.save();
      }
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
