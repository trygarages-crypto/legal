// index.js — Firebase Functions v2, Node 18

const { onValueCreated, onValueUpdated } = require("firebase-functions/v2/database");
const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
admin.initializeApp();

// -----------------------------
// Welcome Notification
// -----------------------------
exports.sendWelcomeNotification = onValueCreated(
  "/user_credits/{userId}",
  async (event) => {
    const userId = event.params.userId;

    console.log("📝 New user created:", userId);

    try {
      const tokenSnapshot = await admin.database()
        .ref(`/user_tokens/${userId}`)
        .once("value");

      const token = tokenSnapshot.val();
      if (!token) {
        console.log(`⚠️ No FCM token for user: ${userId}`);
        return null;
      }

      const message = {
        notification: {
          title: "🎉 Welcome to Try Garage Ai Service!",
          body: "You received 330 free Coins to start transforming your cars!"
        },
        android: {
          notification: {
            icon: "ic_notification",
            color: "#FF6B35"
          }
        },
        apns: {
          payload: {
            aps: { sound: "default" }
          }
        },
        token
      };

      const response = await admin.messaging().send(message);
      console.log(`✅ Welcome notification sent: ${response}`);
      return null;
    } catch (error) {
      console.error("❌ Error sending welcome notification:", error);
      return null;
    }
  }
);

// -----------------------------
// Fraud Detection Notification
// -----------------------------
exports.notifyFraudDetection = onValueUpdated(
  "/user_credits/{userId}/fraud_attempts",
  async (event) => {
    const fraudAttempts = event.data.after.val();
    const userId = event.params.userId;

    console.log(`🚨 Fraud attempts for ${userId}: ${fraudAttempts}`);

    if (![1, 3, 5].includes(fraudAttempts)) return null;

    try {
      const tokenSnapshot = await admin.database()
        .ref(`/user_tokens/${userId}`)
        .once("value");

      const token = tokenSnapshot.val();
      if (!token) return null;

      const message = {
        notification: {
          title: "⚠️ Unusual Activity Detected",
          body: ` We've seen a ${fraudAttempts} clearing cache. Contact support if you have any concerns.`
        },
        data: {
          type: "fraud_detection",
          attempts: fraudAttempts.toString(),
          user_id: userId
        },
        android: {
          priority: "high",
          notification: {
            icon: "ic_warning",
            color: "#FF0000",
            sound: "default"
          }
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: { aps: { sound: "default", badge: 1 } }
        },
        token
      };

      const response = await admin.messaging().send(message);
      console.log(`✅ Fraud notification sent: ${response}`);
      return null;
    } catch (error) {
      console.error("❌ Error sending fraud notification:", error);
      return null;
    }
  }
);

// -----------------------------
// Low Credits Reminder
// -----------------------------
exports.sendLowCreditsReminder = onValueUpdated(
  "/user_credits/{userId}/credits",
  async (event) => {
    const newCredits = event.data.after.val();
    const oldCredits = event.data.before.val();
    const userId = event.params.userId;

    if (oldCredits >= 100 && newCredits < 100 && newCredits > 0) {
      try {
        const tokenSnapshot = await admin.database()
          .ref(`/user_tokens/${userId}`)
          .once("value");

        const token = tokenSnapshot.val();
        if (!token) return null;

        const message = {
          notification: {
            title: "💰 Low Credits Warning",
            body: `You have only ${newCredits} Coins left. Get more to keep transforming!`
          },
          data: {
            type: "low_credits",
            credits: newCredits.toString()
          },
          android: { notification: { icon: "ic_coins", color: "#FFD700" } },
          token
        };

        const response = await admin.messaging().send(message);
        console.log(`✅ Low credits notification sent: ${response}`);
        return null;
      } catch (error) {
        console.error("❌ Error sending low credits notification:", error);
        return null;
      }
    }

    return null;
  }
);

// -----------------------------
// Queued Notification (Manual Trigger from Unity)
// -----------------------------
exports.sendQueuedNotification = onValueCreated(
  "/notification_queue/{pushId}",
  async (event) => {
    const data = event.data.val();
    if (!data) return null;

    const { user_id: userId, title, body } = data;

    try {
      const tokenSnapshot = await admin.database()
        .ref(`/user_tokens/${userId}`)
        .once("value");

      const token = tokenSnapshot.val();
      if (!token) {
        console.log(`⚠️ No token for user: ${userId}`);
        await event.data.ref.remove();
        return null;
      }

      const message = {
        notification: { title, body },
        token
      };

      const response = await admin.messaging().send(message);
      console.log(`✅ Queued notification sent: ${response}`);

      // Remove from queue
      await event.data.ref.remove();
      return null;
    } catch (error) {
      console.error("❌ Error sending queued notification:", error);
      await event.data.ref.remove();
      return null;
    }
  }
);

// -----------------------------
// Batch Notification (Callable)
// -----------------------------
exports.sendBatchNotification = onCall(async (request) => {
  if (!request.auth?.token?.admin) {
    throw new Error("Permission denied: Admins only");
  }

  const { userIds, title, body } = request.data;
  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    throw new Error("Invalid argument: userIds must be a non-empty array");
  }

  try {
    const tokens = [];
    for (const userId of userIds) {
      const snap = await admin.database().ref(`/user_tokens/${userId}`).once("value");
      if (snap.exists()) tokens.push(snap.val());
    }

    if (tokens.length === 0) return { success: false, message: "No valid tokens found" };

    const message = { notification: { title, body } };

    await Promise.all(tokens.map(token => admin.messaging().send({ ...message, token })));

    console.log(`✅ Batch notification sent to ${tokens.length} users`);
    return { success: true, sent: tokens.length, total: userIds.length };
  } catch (error) {
    console.error("❌ Batch notification error:", error);
    throw new Error(error.message);
  }
});
