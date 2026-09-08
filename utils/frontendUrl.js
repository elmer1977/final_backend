const defaultFrontendUrl =
  "https://elmer1977.github.io/Multi-Vendor-Market-Place";

const frontendUrl = (process.env.FRONTEND_URL || defaultFrontendUrl).replace(
  /\/+$/,
  ""
);

const frontendOrigin = (() => {
  try {
    return new URL(frontendUrl).origin;
  } catch {
    return frontendUrl;
  }
})();

module.exports = { frontendUrl, frontendOrigin };
