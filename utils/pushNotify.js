const webpush = require("web-push");

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;

if (!publicKey || !privateKey || !subject) {
  console.warn("VAPID keys are not configured. Web push will not work without VAPID settings.");
}

webpush.setVapidDetails(subject, publicKey, privateKey);

exports.sendPushNotification = async (subscription, payload) => {
  if (!subscription) {
    return;
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to send push notification", error);
  }
};
