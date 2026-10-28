const mongoose = require("mongoose");
const Product = require("../model/product");
const Event = require("../model/event");
const ErrorHandler = require("./ErrorHandler");

const getOrderPricing = async (cart) => {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new ErrorHandler("Your cart is empty.", 400);
  }

  const items = [];
  const shopTotals = {};
  const quantitiesByItem = new Map();
  let subTotalCents = 0;
  let shippingCents = 0;

  for (const item of cart) {
    if (
      !item?._id ||
      !mongoose.Types.ObjectId.isValid(String(item._id)) ||
      !Number.isInteger(Number(item.qty)) ||
      Number(item.qty) < 1
    ) {
      throw new ErrorHandler("The cart contains an invalid item or quantity.", 400);
    }

    const productId = String(item._id);
    const product = await Product.findById(productId);
    const catalogItem = product || (await Event.findById(productId));
    if (!catalogItem) {
      throw new ErrorHandler("A product in your cart is no longer available.", 400);
    }

    const quantity = Number(item.qty);
    const itemKey = `${product ? "product" : "event"}:${productId}`;
    const requestedQuantity = (quantitiesByItem.get(itemKey) || 0) + quantity;
    quantitiesByItem.set(itemKey, requestedQuantity);
    if (requestedQuantity > catalogItem.stock) {
      throw new ErrorHandler(
        `${catalogItem.name} does not have enough stock available.`,
        400
      );
    }

    const originalPrice = Number(catalogItem.originalPrice);
    const currentPrice = Number(catalogItem.discountPrice);
    const unitPrice =
      Number.isFinite(originalPrice) && originalPrice > 0
        ? originalPrice
        : currentPrice;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new ErrorHandler(`${catalogItem.name} has an invalid price.`, 400);
    }

    const unitPriceCents = Math.round(unitPrice * 100);
    const lineTotalCents = unitPriceCents * quantity;
    const shopId = String(catalogItem.shopId);
    if (!shopTotals[shopId]) {
      shopTotals[shopId] = { subTotalCents: 0, shippingCents: 0, totalCents: 0 };
    }
    shopTotals[shopId].subTotalCents += lineTotalCents;
    subTotalCents += lineTotalCents;

    items.push({
      _id: catalogItem._id,
      name: catalogItem.name,
      images: catalogItem.images,
      qty: quantity,
      price: unitPriceCents / 100,
      shopId,
      isEvent: !product,
      isReviewed: false,
    });
  }

  for (const totals of Object.values(shopTotals)) {
    totals.shippingCents = Math.round(totals.subTotalCents * 0.1);
    totals.totalCents = totals.subTotalCents + totals.shippingCents;
    shippingCents += totals.shippingCents;
  }

  return {
    cart: items,
    subTotalPrice: subTotalCents / 100,
    shipping: shippingCents / 100,
    totalPrice: (subTotalCents + shippingCents) / 100,
    shopTotals: Object.fromEntries(
      Object.entries(shopTotals).map(([shopId, totals]) => [
        shopId,
        totals.totalCents / 100,
      ])
    ),
  };
};

module.exports = { getOrderPricing };
