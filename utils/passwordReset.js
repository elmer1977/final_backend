const crypto = require("crypto");

exports.generateResetToken = (user) => {
  const resetToken = crypto.randomBytes(32).toString("hex");

  user.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  user.resetPasswordTime = Date.now() + 15 * 60 * 1000;

  return resetToken;
};

exports.hashResetToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};