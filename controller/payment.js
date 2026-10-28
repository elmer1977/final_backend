const express = require("express");
const router = express.Router();
const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorHandler = require("../utils/ErrorHandler");
const { getOrderPricing } = require("../utils/orderPricing");

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

router.post(
  "/quote",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const pricing = await getOrderPricing(req.body.cart);
      res.status(200).json({ success: true, ...pricing });
    } catch (error) {
      return next(
        error.statusCode ? error : new ErrorHandler(error.message, 500)
      );
    }
  })
);

router.post(
  "/process",
  catchAsyncErrors(async (req, res, next) => {
    try {
      const pricing = await getOrderPricing(req.body.cart);
      const myPayment = await stripe.paymentIntents.create({
        amount: Math.round(pricing.totalPrice * 100),
        currency: "php",
        metadata: {
          company: "Omprakash",
        },
      });
      res.status(200).json({
        success: true,
        client_secret: myPayment.client_secret,
      });
    } catch (error) {
      return next(
        error.statusCode ? error : new ErrorHandler(error.message, 500)
      );
    }
  })
);

router.get(
  "/stripeapikey",
  catchAsyncErrors(async (req, res, next) => {
    res.status(200).json({ stripeApikey: process.env.STRIPE_API_KEY });
  })
);

module.exports = router;
