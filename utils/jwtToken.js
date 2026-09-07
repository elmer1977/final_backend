// Create token and save it in cookies and send response

const sendToken = (user, statusCode, res) => {
  const token = user.getJwtToken();

  const isProduction =
    process.env.NODE_ENV?.toLowerCase() === "production" ||
    process.env.FRONTEND_URL?.startsWith("https://") ||
    res.req?.headers.origin?.startsWith("https://");

  // Options for cookies
  const options = {
    expires: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isProduction,
  };

  res.status(statusCode).cookie("token", token, options).json({
    success: true,
    user,
    token,
  });
};
module.exports = sendToken;
