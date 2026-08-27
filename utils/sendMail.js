const nodemailer = require("nodemailer");

const sendMail = async (options) => {
  // Support both correctly-spelled SMTP_* env vars and the existing SMPT_* typos for compatibility
  const host = process.env.SMTP_HOST || process.env.SMPT_HOST;
  const port = process.env.SMTP_PORT || process.env.SMPT_PORT;
  const service = process.env.SMTP_SERVICE || process.env.SMPT_SERVICE;
  const user = process.env.SMTP_MAIL || process.env.SMPT_MAIL;
  const pass = process.env.SMTP_PASSWORD || process.env.SMPT_PASSWORD;

  const transporter = nodemailer.createTransport({
    host,
    port,
    service,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  const mailOptions = {
    from: user,
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
