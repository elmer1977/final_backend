const nodemailer = require("nodemailer");

const sendMail = async (options) => {
  // Support the original SMPT_* names as well as the correctly-spelled SMTP_* names.
  const host = process.env.SMTP_HOST || process.env.SMPT_HOST;
  const port = Number(process.env.SMTP_PORT || process.env.SMPT_PORT || 587);
  const service = process.env.SMTP_SERVICE || process.env.SMPT_SERVICE;
  const user =
    process.env.SMTP_MAIL ||
    process.env.SMPT_MAIL ||
    process.env.SMTP_USER ||
    process.env.SMPT_USER;
  const pass =
    process.env.SMTP_PASSWORD ||
    process.env.SMPT_PASSWORD ||
    process.env.SMTP_PASS ||
    process.env.SMPT_PASS;
  const from = process.env.SMTP_FROM || process.env.SMPT_FROM || user;

  if (!user || !pass || (!service && !host)) {
    throw new Error(
      "SMTP configuration is incomplete. Set SMTP_MAIL/SMTP_PASSWORD and SMTP_SERVICE or SMTP_HOST on Render."
    );
  }

  const transportConfig = {
    auth: { user, pass },
  };

  if (service) {
    transportConfig.service = service;
  } else {
    transportConfig.host = host;
    transportConfig.port = port;
    transportConfig.secure = port === 465;
  }

  const transporter = nodemailer.createTransport(transportConfig);

  const mailOptions = {
    from,
    to: options.email,
    subject: options.subject,
    text: options.message,
  };

  try {
    // Verify transporter configuration to fail fast with helpful message
    await transporter.verify();
  } catch (err) {
    console.error("SMTP configuration verification failed:", err);
    throw err;
  }

  try {
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("Error sending email:", err);
    throw err;
  }
};

module.exports = sendMail;
