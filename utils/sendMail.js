const { Resend } = require("resend");

const sendMail = async (options) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    throw new Error(
      "Email configuration is incomplete. Set RESEND_API_KEY and EMAIL_FROM on Render."
    );
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: options.email,
    subject: options.subject,
    text: options.message,
  });

  if (error) {
    console.error("Resend email delivery failed:", error);
    throw new Error(error.message || "Resend email delivery failed");
  }
};

module.exports = sendMail;
