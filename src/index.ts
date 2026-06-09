import express, { Request, Response } from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import { OAuth2Client } from "google-auth-library";
import { Resend } from "resend";

interface PopulatedFriendRequest {
  id: string;
  fromUserId: any;
  toUserId: string;
  status: string;
  createdAt: Date;
}

interface UserData {
  id?: string;
  _id?: string;
  username?: string;
  email?: string;
  image?: string;
  isOnline?: boolean;
  lastSeen?: Date;
}

dotenv.config();
const resend = new Resend(process.env.RESEND_API_KEY);
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.FRONTEND_URL}/auth/google/callback`,
);

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/blabber";

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

const userSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    dateOfBirth: { type: Date, required: true },
    password: { type: String, required: true },
    image: String,
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    resetToken: String,
    resetTokenExpiry: Date,
    googleId: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);
const friendRequestSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    fromUserId: {
      type: String,
      required: true,
      ref: "User",
    },
    toUserId: {
      type: String,
      required: true,
      ref: "User",
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "blocked"],
      default: "pending",
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
const friendsSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    friendId: { type: String, required: true },
    friendsSince: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const FriendRequest = mongoose.model("FriendRequest", friendRequestSchema);
const Friends = mongoose.model("Friends", friendsSchema);
const channelSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true, unique: true },
    description: String,
    image: String,
    bgcolor: String,
    inviteCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    inviteLink: String,
    isPrivate: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
    members: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    isDM: { type: Boolean, default: false },
    displayName: String,
    participants: [
      {
        userId: { type: String, required: true },
        username: { type: String, required: true },
        image: String,
      },
    ],
  },
  { timestamps: true },
);

const messageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    userImage: { type: String },
    channelId: { type: String, required: true },
    type: {
      type: String,
      default: "text",
      enum: ["text", "image", "file", "gif"],
    },
    timestamp: { type: Date, default: Date.now },
    seenBy: [
      {
        userId: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    deliveredTo: [{ type: String }],
  },
  { timestamps: true },
);

const User = mongoose.model("User", userSchema);
const Channel = mongoose.model("Channel", channelSchema);
const Message = mongoose.model("Message", messageSchema);

const FRONTEND_URL =
  process.env.NODE_ENV === "production"
    ? "https://blabber-chat.netlify.app"
    : "http://localhost:3000";

const app = express();
const server = http.createServer(app);
const sendEmail = async (to: string, subject: string, html: string) => {
  try {
    const { data, error } = await resend.emails.send({
      from: "Blabber <onboarding@resend.dev>",
      to: [to],
      subject: subject,
      html: html,
    });

    if (error) {
      console.error("❌ Email error:", error);
      return false;
    }

    console.log("✅ Email sent:", data?.id);
    return true;
  } catch (error) {
    console.error("❌ Email failed:", error);
    return false;
  }
};
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`, {
    ip: req.ip,
    origin: req.headers.origin,
    timestamp: new Date().toISOString(),
  });
  next();
});

app.get("/", (req, res) => {
  res.json({
    message: "Blabber Backend API is running! 🚀",
    status: "active",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    endpoints: {
      register: "POST /api/register",
      login: "POST /api/login",
      health: "GET /health",
      test: "GET /api/test",
    },
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

app.get("/api/test", async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    const channelCount = await Channel.countDocuments();
    const messageCount = await Message.countDocuments();

    res.json({
      message: "API is working!",
      users: userCount,
      channels: channelCount,
      messages: messageCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.json({
      message: "API is working but MongoDB might have issues",
      timestamp: new Date().toISOString(),
    });
  }
});

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
  connectTimeout: 45000,
  pingTimeout: 20000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
});

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.post("/api/friends/request", async (req, res) => {
  try {
    const { fromUserId, toUsername } = req.body;

    if (!fromUserId || !toUsername) {
      return res
        .status(400)
        .json({ error: "User ID and username are required" });
    }

    const fromUser = await User.findOne({ id: fromUserId });
    if (!fromUser || fromUser.username === toUsername) {
      return res
        .status(400)
        .json({ error: "You cannot send friend request to yourself" });
    }

    const toUser = await User.findOne({ username: toUsername });
    if (!toUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const existingRequest = await FriendRequest.findOne({
      $or: [
        { fromUserId, toUserId: toUser.id },
        { fromUserId: toUser.id, toUserId: fromUserId },
      ],
    });

    if (existingRequest) {
      return res.status(400).json({
        error: "Friend request already exists",
        status: existingRequest.status,
      });
    }

    const existingFriendship = await Friends.findOne({
      $or: [
        { userId: fromUserId, friendId: toUser.id },
        { userId: toUser.id, friendId: fromUserId },
      ],
    });

    if (existingFriendship) {
      return res.status(400).json({ error: "You are already friends" });
    }

    const friendRequest = new FriendRequest({
      id: "friendreq_" + Date.now(),
      fromUserId,
      toUserId: toUser.id,
      status: "pending",
    });

    await friendRequest.save();

    io.emit("friend:request:sent", {
      requestId: friendRequest.id,
      fromUser: {
        id: fromUser.id,
        username: fromUser.username,
        image: fromUser.image,
        email: fromUser.email,
        isOnline: fromUser.isOnline,
      },
      toUserId: toUser.id,
    });

    res.json({
      success: true,
      message: "Friend request sent successfully",
      request: friendRequest,
    });
  } catch (error) {
    console.error("Send friend request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/friends/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const friendships = await Friends.find({ userId });

    const friends = await Promise.all(
      friendships.map(async (friendship) => {
        const friendUser = await User.findOne(
          { id: friendship.friendId },
          { password: 0, resetToken: 0, resetTokenExpiry: 0 },
        );

        return {
          id: friendship.id,
          userId: friendship.userId,
          friendId: friendship.friendId,
          friendsSince: friendship.friendsSince,
          username: friendUser?.username,
          email: friendUser?.email,
          image: friendUser?.image,
          isOnline: friendUser?.isOnline,
          lastSeen: friendUser?.lastSeen,
        };
      }),
    );

    console.log(`📥 Fetched ${friends.length} friends for user ${userId}`);

    res.json({
      success: true,
      friends,
    });
  } catch (error) {
    console.error("Get friends error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/friends/requests/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`📥 Fetching friend requests for user: ${userId}`);

    const pendingRequests = await FriendRequest.find({
      toUserId: userId,
      status: "pending",
    });

    console.log(`Found ${pendingRequests.length} pending requests`);

    const transformedRequests = await Promise.all(
      pendingRequests.map(async (request: any) => {
        const fromUser = await User.findOne(
          { id: request.fromUserId },
          { password: 0, resetToken: 0, resetTokenExpiry: 0 },
        );

        console.log(
          `Request from ${request.fromUserId}:`,
          fromUser ? `Found user: ${fromUser.username}` : "User not found",
        );

        return {
          id: request.id,
          fromUserId: request.fromUserId,
          toUserId: request.toUserId,
          status: request.status,
          createdAt: request.createdAt,
          fromUser: fromUser
            ? {
                id: fromUser.id,
                username: fromUser.username,
                email: fromUser.email,
                image: fromUser.image,
                isOnline: fromUser.isOnline,
                lastSeen: fromUser.lastSeen,
              }
            : null,
        };
      }),
    );

    console.log(
      `✅ Returning ${transformedRequests.length} friend requests`,
      transformedRequests,
    );

    res.json({
      success: true,
      requests: transformedRequests,
    });
  } catch (error) {
    console.error("❌ Get friend requests error:", error);
    res.status(500).json({
      error: "Internal server error",
      details: (error as Error).message,
    });
  }
});

app.post("/api/friends/accept", async (req, res) => {
  try {
    const { requestId, userId } = req.body;

    const friendRequest = await FriendRequest.findOne({ id: requestId });
    if (!friendRequest) {
      return res.status(404).json({ error: "Friend request not found" });
    }

    if (friendRequest.toUserId !== userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to accept this request" });
    }

    friendRequest.status = "accepted";
    await friendRequest.save();

    const friendship1 = new Friends({
      id: "friends_" + Date.now(),
      userId: friendRequest.fromUserId,
      friendId: friendRequest.toUserId,
    });

    const friendship2 = new Friends({
      id: "friends_" + (Date.now() + 1),
      userId: friendRequest.toUserId,
      friendId: friendRequest.fromUserId,
    });

    await Promise.all([friendship1.save(), friendship2.save()]);

    const fromUser = await User.findOne({ id: friendRequest.fromUserId });
    const toUser = await User.findOne({ id: friendRequest.toUserId });

    io.emit("friend:request:accepted", {
      requestId,
      fromUser: {
        id: fromUser?.id,
        username: fromUser?.username,
        image: fromUser?.image,
        email: fromUser?.email,
        isOnline: fromUser?.isOnline,
      },
      toUser: {
        id: toUser?.id,
        username: toUser?.username,
        image: toUser?.image,
        email: toUser?.email,
        isOnline: toUser?.isOnline,
      },
    });

    res.json({
      success: true,
      message: "Friend request accepted",
      friendship: friendship1,
    });
  } catch (error) {
    console.error("Accept friend request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/friends/reject", async (req, res) => {
  try {
    const { requestId, userId } = req.body;

    const friendRequest = await FriendRequest.findOne({ id: requestId });
    if (!friendRequest) {
      return res.status(404).json({ error: "Friend request not found" });
    }

    if (friendRequest.toUserId !== userId) {
      return res
        .status(403)
        .json({ error: "Not authorized to reject this request" });
    }

    friendRequest.status = "rejected";
    await friendRequest.save();

    io.emit("friend:request:rejected", {
      requestId,
      fromUserId: friendRequest.fromUserId,
      toUserId: friendRequest.toUserId,
    });

    res.json({
      success: true,
      message: "Friend request rejected",
    });
  } catch (error) {
    console.error("Reject friend request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/api/friends/remove", async (req, res) => {
  try {
    const { userId, friendId } = req.body;

    await Friends.deleteMany({
      $or: [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ],
    });

    await FriendRequest.deleteMany({
      $or: [
        { fromUserId: userId, toUserId: friendId },
        { fromUserId: friendId, toUserId: userId },
      ],
    });

    io.emit("friend:removed", {
      userId,
      friendId,
    });

    res.json({
      success: true,
      message: "Friend removed successfully",
    });
  } catch (error) {
    console.error("Remove friend error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/users/search", async (req, res) => {
  try {
    const { query, currentUserId } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const users = await User.find(
      {
        $and: [
          {
            $or: [
              { username: { $regex: query, $options: "i" } },
              { email: { $regex: query, $options: "i" } },
            ],
          },
          { id: { $ne: currentUserId } },
        ],
      },
      { password: 0 },
    );

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Search users error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/auth/google", async (req, res) => {
  try {
    const { code, mode = "login" } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authorization code is required",
      });
    }

    const { tokens } = await googleClient.getToken({
      code: code,
      redirect_uri: `${process.env.FRONTEND_URL}/auth/google/callback`,
    });

    if (!tokens.id_token) {
      return res.status(400).json({
        success: false,
        message: "Failed to get ID token",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID token",
      });
    }

    const {
      sub: googleId,
      email,
      name,
      picture,
      given_name,
      family_name,
    } = payload;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required from Google",
      });
    }

    let user = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { googleId: googleId }],
    });

    if (!user && mode === "login") {
      return res.status(401).json({
        success: false,
        message:
          "No account found with this Google account. Please sign up first.",
        needsSignup: true,
        email: email,
      });
    }

    if (!user) {
      const baseUsername = email
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");
      let username = baseUsername;
      let counter = 1;

      while (await User.findOne({ username })) {
        username = `${baseUsername}${counter}`;
        counter++;
      }

      let userImage = `https://ui-avatars.com/api/?name=${encodeURIComponent(
        name || username,
      )}&background=random&color=000000&bold=true`;

      if (picture) {
        try {
          console.log(
            `📤 Uploading Google profile image to Cloudinary for ${email}`,
          );

          const uploadResult = await cloudinary.uploader.upload(picture, {
            folder: "blabber/users",
            quality: "auto:best",
            fetch_format: "auto",
            width: 400,
            height: 400,
            crop: "fill",
            gravity: "auto",
            format: "jpg",
          });

          userImage = uploadResult.secure_url;
          console.log(`✅ Google image uploaded to Cloudinary: ${userImage}`);
        } catch (uploadError) {
          console.error(
            "❌ Failed to upload Google image to Cloudinary:",
            uploadError,
          );
          userImage = picture;
          console.log(`⚠️ Using original Google image URL: ${userImage}`);
        }
      }

      user = new User({
        id: "user_" + Date.now(),
        username: username,
        email: email.toLowerCase(),
        password: await bcrypt.hash(
          Math.random().toString(36) + Date.now().toString(),
          12,
        ),
        image: userImage,
        isOnline: true,
        lastSeen: new Date(),
        googleId: googleId,
        dateOfBirth: new Date(Date.now() - 13 * 365 * 24 * 60 * 60 * 1000),
      });

      await user.save();
      console.log(`✅ New Google user registered: ${username} (${email})`);

      setTimeout(async () => {
        try {
          const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Welcome to Blabber! 🎉",
            html: `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Blabber</title>
  </head>
  <body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: Poppins, Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 40px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
      <div style="background: linear-gradient(135deg, #0C3D2B 0%, #1A5D3E 100%); padding: 40px 30px; text-align: center; color: white;">
        <img src="https://res.cloudinary.com/dn2p1dgjf/image/upload/v1760347337/logo_v9sbcv.png" alt="Blabber Logo" style="max-width: 70px; height: 70px; margin-bottom: 20px;">
        <h2 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: bold;">Welcome to Blabber! 🎉</h2>
        <p style="color: #e0e0e0; margin: 0; font-size: 16px;">Your Google account has been successfully connected</p>
      </div>
      
      <div style="padding: 40px 30px; background-color: #ffffff; color: #333333;">
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Hi <strong style="color: #0C3D2B;">${username}</strong>,
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Your Google account has been successfully connected to Blabber! You can now use Google to sign in quickly and securely.
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
          Start connecting with your friends and communities!
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="background: linear-gradient(135deg, #0C3D2B 0%, #1A5D3E 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; font-size: 16px; border: none; cursor: pointer;">
            GET STARTED
          </a>
        </div>
        
        <div style="border-top: 1px solid #eeeeee; margin-top: 30px; padding-top: 20px;">
          <p style="font-size: 14px; color: #666; line-height: 1.5;">
            Best regards,<br>
            <strong>The Blabber Team</strong>
          </p>
        </div>
      </div>
      
      <div style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #eeeeee;">
        <p style="font-size: 12px; color: #888; margin: 0;">
          © ${new Date().getFullYear()} Blabber. All rights reserved.
        </p>
      </div>
    </div>
  </body>
  </html>
  `,
          };

          await sendEmail(email, "Welcome to Blabber! 🎉", mailOptions.html);
          console.log(`✅ Welcome email sent to Google user: ${email}`);
        } catch (emailError) {
          console.log(
            "⚠️ Failed to send welcome email to Google user:",
            emailError,
          );
        }
      }, 0);
    } else if (user) {
      user.googleId = googleId;

      if (picture && user.image === picture) {
        try {
          console.log(
            `📤 Updating existing Google user image to Cloudinary for ${email}`,
          );

          const uploadResult = await cloudinary.uploader.upload(picture, {
            folder: "blabber/users",
            quality: "auto:best",
            fetch_format: "auto",
            width: 400,
            height: 400,
            crop: "fill",
            gravity: "auto",
            format: "jpg",
          });

          user.image = uploadResult.secure_url;
          console.log(
            `✅ Existing Google image uploaded to Cloudinary: ${user.image}`,
          );
        } catch (uploadError) {
          console.error(
            "❌ Failed to upload existing Google image to Cloudinary:",
            uploadError,
          );
        }
      } else if (picture && user.image !== picture) {
        user.image = picture;
      }

      user.isOnline = true;
      user.lastSeen = new Date();
      await user.save();
      console.log(`✅ Google user logged in: ${user.username} (${email})`);
    }

    const userResponse = {
      id: user.id,
      username: user.username,
      email: user.email,
      image: user.image,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
    };

    res.json({
      success: true,
      user: userResponse,
      message: mode === "signup" ? "Signup successful" : "Login successful",
      isNewUser:
        !user.createdAt ||
        Date.now() - new Date(user.createdAt).getTime() < 60000,
    });
  } catch (error) {
    console.error("Google OAuth error:", error);
    res.status(401).json({
      success: false,
      message: `Google ${req.body.mode || "authentication"} failed`,
    });
  }
});
const generateInviteCode = () => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};

try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  console.log("✅ Cloudinary configured successfully");
} catch (error) {
  console.error("❌ Cloudinary configuration failed:", error);
}
const deleteCloudinaryImage = async (imageUrl: string) => {
  try {
    if (!imageUrl || !imageUrl.includes("cloudinary.com")) {
      console.log("⚠️ Not a Cloudinary URL, skipping deletion:", imageUrl);
      return true;
    }

    const url = new URL(imageUrl);
    const pathParts = url.pathname.split("/");

    const uploadIndex = pathParts.indexOf("upload");
    if (uploadIndex === -1) {
      console.log("❌ Invalid Cloudinary URL format");
      return false;
    }

    const pathAfterUpload = pathParts.slice(uploadIndex + 1).join("/");
    const publicId = pathAfterUpload
      .replace(/^v\d+\//, "")
      .replace(/\.[^/.]+$/, "");

    console.log(`🗑️ Attempting to delete Cloudinary image: ${publicId}`);

    const result = await cloudinary.uploader.destroy(publicId);

    if (result.result === "ok") {
      console.log(`✅ Successfully deleted: ${publicId}`);
      return true;
    } else {
      console.log(`❌ Cloudinary deletion failed: ${publicId}`, result);
      return false;
    }
  } catch (error) {
    console.error("Error deleting Cloudinary image:", error);
    return false;
  }
};
app.post(
  "/api/upload/message-image",
  express.json({ limit: "10mb" }),
  async (req: express.Request, res: express.Response) => {
    try {
      const { image } = req.body;

      if (!image) {
        return res.status(400).json({
          success: false,
          message: "No image data provided",
        });
      }

      const result = await cloudinary.uploader.upload(image, {
        folder: "blabber/messages",
        quality: "auto:good",
        fetch_format: "auto",
      });

      console.log("Message image uploaded to Cloudinary:", result.secure_url);

      res.json({
        success: true,
        image_url: result.secure_url,
      });
    } catch (error: any) {
      console.error("Message image upload error:", error);
      res.status(500).json({
        success: false,
        message: "Upload failed: " + error.message,
      });
    }
  },
);
app.post(
  "/api/upload/channel-image",
  express.json({ limit: "10mb" }),
  async (req: express.Request, res: express.Response) => {
    try {
      const { image } = req.body;

      if (!image) {
        return res.status(400).json({
          success: false,
          message: "No image data provided",
        });
      }

      const result = await cloudinary.uploader.upload(image, {
        folder: "blabber/channels",
        quality: "auto:best",
        fetch_format: "auto",
        width: 500,
        height: 500,
        crop: "fill",
      });

      console.log("Channel image uploaded to Cloudinary:", result.secure_url);

      res.json({
        success: true,
        image_url: result.secure_url,
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({
        success: false,
        message: "Upload failed: " + error.message,
      });
    }
  },
);
app.get("/api/channel/:channelId/members", async (req, res) => {
  try {
    const { channelId } = req.params;

    const channel = await Channel.findOne({ id: channelId });
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    const members = await User.find(
      { id: { $in: channel.members } },
      { password: 0, resetToken: 0, resetTokenExpiry: 0 },
    );

    res.json({ success: true, members });
  } catch (error) {
    console.error("Get channel members error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/channel/:channelId/members", async (req, res) => {
  try {
    const { channelId } = req.params;
    const { username, addedBy } = req.body;

    if (!username || !addedBy) {
      return res
        .status(400)
        .json({ error: "Username and addedBy are required" });
    }

    const channel = await Channel.findOne({ id: channelId });
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.createdBy !== addedBy) {
      return res
        .status(403)
        .json({ error: "Only channel creator can add members" });
    }

    const userToAdd = await User.findOne({ username: username.trim() });
    if (!userToAdd) {
      return res.status(404).json({ error: "User not found" });
    }

    if (channel.members.includes(userToAdd.id)) {
      return res.status(400).json({ error: "User is already a member" });
    }

    channel.members.push(userToAdd.id);
    await channel.save();

    console.log(
      `✅ User ${userToAdd.username} added to channel ${channel.name}`,
    );

    io.emit("channel:updated", channel);

    res.json({
      success: true,
      message: `${userToAdd.username} added to channel successfully`,
    });
  } catch (error) {
    console.error("Add member error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/channel/:channelId/members/:memberId", async (req, res) => {
  try {
    const { channelId, memberId } = req.params;
    const { removedBy } = req.body;

    if (!removedBy) {
      return res.status(400).json({ error: "removedBy is required" });
    }

    const channel = await Channel.findOne({ id: channelId });
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.createdBy !== removedBy) {
      return res
        .status(403)
        .json({ error: "Only channel creator can remove members" });
    }

    if (memberId === channel.createdBy) {
      return res.status(400).json({ error: "Cannot remove channel creator" });
    }

    if (!channel.members.includes(memberId)) {
      return res
        .status(400)
        .json({ error: "User is not a member of this channel" });
    }

    channel.members = channel.members.filter((id) => id !== memberId);
    await channel.save();

    console.log(`✅ User ${memberId} removed from channel ${channel.name}`);

    io.emit("channel:updated", channel);

    res.json({
      success: true,
      message: "Member removed from channel successfully",
    });
  } catch (error) {
    console.error("Remove member error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/channel/:channelId/leave", async (req, res) => {
  try {
    const { channelId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const channel = await Channel.findOne({ id: channelId });
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.createdBy === userId) {
      return res.status(400).json({
        error:
          "Channel creator cannot leave. Please delete the channel instead.",
      });
    }

    if (!channel.members.includes(userId)) {
      return res
        .status(400)
        .json({ error: "You are not a member of this channel" });
    }

    channel.members = channel.members.filter((id) => id !== userId);
    await channel.save();

    console.log(`✅ User ${userId} left channel ${channel.name}`);

    io.emit("channel:updated", channel);

    io.emit("user:left-channel", { channelId, userId });

    res.json({
      success: true,
      message: "You have left the channel successfully",
    });
  } catch (error) {
    console.error("Leave channel error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/channel/:channelId/settings", async (req, res) => {
  try {
    const { channelId } = req.params;
    const { name, description, image, bgcolor, isPrivate, updatedBy, userId } =
      req.body;

    const updatingUser = updatedBy || userId;

    if (!updatingUser) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const channel = await Channel.findOne({ id: channelId });
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.createdBy !== updatingUser) {
      return res
        .status(403)
        .json({ error: "Only channel creator can update settings" });
    }

    if (
      image &&
      image !== channel.image &&
      channel.image &&
      channel.image.includes("cloudinary.com")
    ) {
      await deleteCloudinaryImage(channel.image);
    }

    if (name) channel.name = name.trim();
    if (description !== undefined) channel.description = description;
    if (image) channel.image = image;
    if (bgcolor) channel.bgcolor = bgcolor;
    if (isPrivate !== undefined) channel.isPrivate = isPrivate;

    await channel.save();

    console.log(`✅ Channel settings updated: ${channel.name}`);

    io.emit("channel:updated", channel);

    res.json({
      success: true,
      channel: channel,
      message: "Channel settings updated successfully",
    });
  } catch (error) {
    console.error("Update channel settings error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/channel/:channelId", async (req, res) => {
  try {
    const { channelId } = req.params;
    const { name, description, image, bgcolor, userId, updatedBy } = req.body;

    const updatingUser = userId || updatedBy;

    if (!updatingUser) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const channel = await Channel.findOne({ id: channelId });
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.createdBy !== updatingUser) {
      return res.status(403).json({ error: "Only creator can update channel" });
    }

    if (
      image &&
      image !== channel.image &&
      channel.image &&
      channel.image.includes("cloudinary.com")
    ) {
      await deleteCloudinaryImage(channel.image);
    }

    if (name) channel.name = name.trim();
    if (description !== undefined) channel.description = description;
    if (image) channel.image = image;
    if (bgcolor) channel.bgcolor = bgcolor;

    await channel.save();
    console.log(`✅ Channel updated: ${channel.name}`);

    io.emit("channel:updated", channel);

    res.json({ success: true, channel });
  } catch (error) {
    console.error("Update channel error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.put("/api/user/profile", async (req, res) => {
  try {
    const { userId, username, email, image } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (
      image &&
      image !== user.image &&
      user.image &&
      !user.image.includes("ui-avatars.com")
    ) {
      console.log(
        `🔄 Avatar changed in profile update, deleting previous: ${user.image}`,
      );
      await deleteCloudinaryImage(user.image);
    }

    if (username && username !== user.username) {
      const existingUsername = await User.findOne({
        username: username.trim().toLowerCase(),
        id: { $ne: userId },
      });
      if (existingUsername) {
        return res.status(400).json({ error: "Username already taken" });
      }
    }

    if (email && email !== user.email) {
      const existingEmail = await User.findOne({
        email: email.trim().toLowerCase(),
        id: { $ne: userId },
      });
      if (existingEmail) {
        return res.status(400).json({ error: "Email already taken" });
      }
    }

    if (username) user.username = username.trim();
    if (email) user.email = email.trim().toLowerCase();
    if (image) user.image = image;

    await user.save();
    console.log(`✅ User profile updated: ${user.username} (${user.id})`);

    io.emit("user:updated", {
      id: user.id,
      username: user.username,
      email: user.email,
      image: user.image,
      isOnline: user.isOnline,
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        image: user.image,
        isOnline: user.isOnline,
      },
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.put("/api/user/change-password", async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        error:
          "Password must be at least 6 characters with letters and numbers",
      });
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    user.password = hashedPassword;
    await user.save();

    console.log(`✅ Password changed for user: ${user.username}`);

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/upload/user-avatar",
  express.json({ limit: "10mb" }),
  async (req: express.Request, res: express.Response) => {
    try {
      const { image, userId } = req.body;

      if (!image || !userId) {
        return res.status(400).json({
          success: false,
          message: "Image data and user ID are required",
        });
      }

      const user = await User.findOne({ id: userId });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const currentAvatarUrl = user.image;
      let deleteSuccess = true;

      if (currentAvatarUrl && !currentAvatarUrl.includes("ui-avatars.com")) {
        console.log(`🔄 Deleting previous avatar for user ${userId}`);
        deleteSuccess = await deleteCloudinaryImage(currentAvatarUrl);

        if (!deleteSuccess) {
          console.log(
            "⚠️ Failed to delete previous avatar, but continuing with upload...",
          );
        }
      }

      const result = await cloudinary.uploader.upload(image, {
        folder: "blabber/users",
        quality: "auto:best",
        fetch_format: "auto",
        width: 400,
        height: 400,
        crop: "fill",
        gravity: "auto",
        format: "jpg",
      });

      console.log("✅ New avatar uploaded to Cloudinary:", result.secure_url);

      user.image = result.secure_url;
      await user.save();

      io.emit("user:updated", {
        id: user.id,
        username: user.username,
        email: user.email,
        image: user.image,
        isOnline: user.isOnline,
      });

      res.json({
        success: true,
        image_url: result.secure_url,
        previous_deleted: deleteSuccess,
      });
    } catch (error: any) {
      console.error("Avatar upload error:", error);
      res.status(500).json({
        success: false,
        message: "Upload failed: " + error.message,
      });
    }
  },
);
app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password, image, dateOfBirth } = req.body; // ADD dateOfBirth

    if (!username || !email || !password || !dateOfBirth) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    if (age < 13) {
      return res
        .status(400)
        .json({ error: "You must be at least 13 years old to register" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const usernameRegex = /^[a-zA-Z0-9_]{4,20}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        error:
          "Username must be 4-20 characters and can only contain letters, numbers, and underscores",
      });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        error:
          "Password must be at least 6 characters with letters and numbers",
      });
    }

    const existingUser = await User.findOne({
      $or: [
        { email: email.toLowerCase() },
        { username: username.trim().toLowerCase() },
      ],
    });

    if (existingUser) {
      return res.status(400).json({
        error: "User already exists with this email or username",
      });
    }
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = new User({
      id: "user_" + Date.now(),
      username: username.trim(),
      email: email.trim().toLowerCase(),
      dateOfBirth: new Date(dateOfBirth),
      password: hashedPassword,
      image:
        image ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(
          username,
        )}&background=random&color=000000&bold=true`,
      isOnline: true,
      lastSeen: new Date(),
    });

    await newUser.save();
    console.log(`✅ New user registered: ${username} (${email})`);

    setTimeout(async () => {
      try {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email,
          subject: "Welcome to Blabber! 🎉",
          html: `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to Blabber</title>
  </head>
  <body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: Poppins, Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 40px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
      <div style="background: linear-gradient(135deg, #0C3D2B 0%, #1A5D3E 100%); padding: 40px 30px; text-align: center; color: white;">
        <img src="https://res.cloudinary.com/dn2p1dgjf/image/upload/v1760347337/logo_v9sbcv.png" alt="Blabber Logo" style="max-width: 70px; height: 70px; margin-bottom: 20px;">
        <h2 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: bold;">Welcome to Blabber! 🎉</h2>
        <p style="color: #e0e0e0; margin: 0; font-size: 16px;">Your account has been successfully created</p>
      </div>
      
      <div style="padding: 40px 30px; background-color: #ffffff; color: #333333;">
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Hi <strong style="color: #0C3D2B;">${username}</strong>,
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Your account has been successfully created and you're ready to start connecting with others!
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
          You can now login and start blabbering away!
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="background: linear-gradient(135deg, #0C3D2B 0%, #1A5D3E 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; font-size: 16px; border: none; cursor: pointer;">
            GET STARTED
          </a>
        </div>
        
        <div style="border-top: 1px solid #eeeeee; margin-top: 30px; padding-top: 20px;">
          <p style="font-size: 14px; color: #666; line-height: 1.5;">
            Best regards,<br>
            <strong>The Blabber Team</strong>
          </p>
        </div>
      </div>
      
      <div style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #eeeeee;">
        <p style="font-size: 12px; color: #888; margin: 0;">
          © ${new Date().getFullYear()} Blabber. All rights reserved.
        </p>
      </div>
    </div>
  </body>
  </html>
  `,
        };

        await sendEmail(email, "Welcome to Blabber! 🎉", mailOptions.html);
        console.log(`✅ Welcome email sent to: ${email}`);
      } catch (emailError) {
        console.log(
          "⚠️ Failed to send welcome email:",
          emailError instanceof Error ? emailError.message : String(emailError),
        );
      }
    }, 0);

    res.json({
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        image: newUser.image,
        isOnline: newUser.isOnline,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(
        `❓ Password reset requested for non-existent email: ${email}`,
      );
      return res.json({
        message:
          "If the email exists, password reset instructions have been sent",
      });
    }

    const resetToken =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15);

    user.resetToken = resetToken;
    user.resetTokenExpiry = new Date(Date.now() + 3600000);
    await user.save();

    console.log(`🔐 Password reset token generated for: ${email}`);

    res.json({
      message:
        "If the email exists, password reset instructions have been sent",
    });

    setTimeout(async () => {
      try {
        const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(
          email,
        )}`;

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email,
          subject: "Reset Your Blabber Password",
          html: `
              <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password</title>
  </head>
  <body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: Poppins, Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 40px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
      <div style="background: linear-gradient(135deg, #0C3D2B 0%, #1A5D3E 100%); padding: 40px 30px; text-align: center; color: white;">
        <img src="https://res.cloudinary.com/dn2p1dgjf/image/upload/v1760347337/logo_v9sbcv.png" alt="Blabber Logo" style="max-width: 70px; height: 70px; margin-bottom: 20px;">
        <h2 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: bold;">Reset Your Password</h2>
        <p style="color: #e0e0e0; margin: 0; font-size: 16px;">Secure your account access</p>
      </div>
      
      <div style="padding: 40px 30px; background-color: #ffffff; color: #333333;">
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Hi <strong style="color: #0C3D2B;">${user.username}</strong>,
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          We received a request to reset your password for your Blabber account.
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
          Click the button below to create a new password:
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background: linear-gradient(135deg, #0C3D2B 0%, #1A5D3E 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; font-size: 16px; border: none; cursor: pointer;">
            RESET PASSWORD
          </a>
        </div>
        
        <p style="font-size: 14px; color: #666; line-height: 1.5; background-color: #f8f9fa; padding: 15px; border-radius: 10px; border-left: 4px solid #0C3D2B;">
          <strong>Note:</strong> This link will expire in 1 hour. If you didn't request this, please ignore this email.
        </p>
        
        <div style="border-top: 1px solid #eeeeee; margin-top: 30px; padding-top: 20px;">
          <p style="font-size: 14px; color: #666; line-height: 1.5;">
            Best regards,<br>
            <strong>The Blabber Team</strong>
          </p>
        </div>
      </div>
      
      <div style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #eeeeee;">
        <p style="font-size: 12px; color: #888; margin: 0;">
          © ${new Date().getFullYear()} Blabber. All rights reserved.
        </p>
      </div>
    </div>
  </body>
  </html>
          `,
        };

        await sendEmail(email, "Reset Your Blabber Password", mailOptions.html);
        console.log(`✅ Password reset email sent to: ${email}`);
      } catch (emailError) {
        console.error("❌ Failed to send reset email:", emailError);
      }
    }, 0);
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, email, newPassword } = req.body;

    if (!token || !email || !newPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        error:
          "Password must be at least 6 characters with letters and numbers",
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ error: "Invalid reset token" });
    }

    if (!user.resetToken || user.resetToken !== token) {
      return res.status(400).json({ error: "Invalid reset token" });
    }

    if (
      !user.resetTokenExpiry ||
      Date.now() > user.resetTokenExpiry.getTime()
    ) {
      return res.status(400).json({ error: "Reset token has expired" });
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    user.password = hashedPassword;
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    console.log(`✅ Password reset successful for: ${email}`);

    setTimeout(async () => {
      try {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: email,
          subject: "Your Blabber Password Has Been Reset ✅",
          html: `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset Successful</title>
  </head>
  <body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: Poppins, Arial, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 40px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
      <!-- Main content with gradient background -->
      <div style="background: linear-gradient(135deg, #0C3D2B 0%, #1A5D3E 100%); padding: 40px 30px; text-align: center; color: white;">
        <img src="https://res.cloudinary.com/dn2p1dgjf/image/upload/v1760347337/logo_v9sbcv.png" alt="Blabber Logo" style="max-width: 70px; height: 70px; margin-bottom: 20px;">
        <h2 style="color: #ffffff; margin: 0 0 10px 0; font-size: 28px; font-weight: bold;">Password Reset Successful ✅</h2>
        <p style="color: #e0e0e0; margin: 0; font-size: 16px;">Your account security has been updated</p>
      </div>
      
      <!-- White background content area -->
      <div style="padding: 40px 30px; background-color: #ffffff; color: #333333;">
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Hi <strong style="color: #0C3D2B;">${user.username}</strong>,
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
          Your Blabber password has been successfully reset. You can now log in to your account with your new password.
        </p>
        
        <p style="font-size: 16px; line-height: 1.6; margin-bottom: 30px; color: #666;">
          If you did not make this change, please contact our support team immediately to secure your account.
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="background: linear-gradient(135deg, #0C3D2B 0%, #1A5D3E 100%); color: white; padding: 14px 35px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; font-size: 16px; border: none; cursor: pointer;">
            LOGIN TO BLABBER
          </a>
        </div>
        
        <div style="border-top: 1px solid #eeeeee; margin-top: 30px; padding-top: 20px;">
          <p style="font-size: 14px; color: #666; line-height: 1.5;">
            Best regards,<br>
            <strong>The Blabber Team</strong>
          </p>
        </div>
      </div>
      
      <!-- Footer -->
      <div style="background-color: #f8f9fa; padding: 20px 30px; text-align: center; border-top: 1px solid #eeeeee;">
        <p style="font-size: 12px; color: #888; margin: 0;">
          © ${new Date().getFullYear()} Blabber. All rights reserved.<br>
          <a href="${FRONTEND_URL}/tos" style="color: #0C3D2B; text-decoration: none;">Terms of Service</a> | 
          <a href="${FRONTEND_URL}/privacy" style="color: #0C3D2B; text-decoration: none;">Privacy Policy</a>
        </p>
      </div>
    </div>
  </body>
  </html>
  `,
        };

        await sendEmail(
          email,
          "Your Blabber Password Has Been Reset ✅",
          mailOptions.html,
        );
        console.log(`✅ Password reset confirmation sent to: ${email}`);
      } catch (emailError) {
        console.log("⚠️ Failed to send confirmation email:", emailError);
      }
    }, 0);

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    console.log(`✅ User logged in: ${user.username} (${email})`);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        image: user.image,
        isOnline: user.isOnline,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/channel/invite/:inviteCode", async (req, res) => {
  try {
    const { inviteCode } = req.params;
    const channel = await Channel.findOne({ inviteCode });

    if (!channel) {
      return res.status(404).json({ error: "Invalid invite link" });
    }

    res.json({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      image: channel.image,
      bgcolor: channel.bgcolor,
      memberCount: channel.members.length,
    });
  } catch (error) {
    console.error("Get channel error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/channel/join/:inviteCode", async (req, res) => {
  try {
    const { inviteCode } = req.params;
    const { userId } = req.body;

    console.log(`👤 User ${userId} attempting to join via ${inviteCode}`);

    const channel = await Channel.findOne({ inviteCode });
    if (!channel) {
      return res.status(404).json({ error: "Invalid invite link" });
    }

    if (!channel.members.includes(userId)) {
      channel.members.push(userId);
      await channel.save();
      console.log(`✅ User ${userId} joined channel ${channel.name}`);
    } else {
      console.log(`ℹ️ User ${userId} already a member of ${channel.name}`);
    }

    res.json({ channel });
  } catch (error) {
    console.error("Join channel error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 });
    res.json(users);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/channel/create", async (req, res) => {
  try {
    const { name, description, image, bgcolor, isPrivate, createdBy } =
      req.body;

    if (!name || !createdBy) {
      return res.status(400).json({ error: "Name and createdBy are required" });
    }

    const user = await User.findOne({ id: createdBy });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const existingChannel = await Channel.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
    });

    if (existingChannel) {
      return res.status(400).json({
        error: `Channel "${name}" already exists. Please choose a different name.`,
      });
    }

    const inviteCode = generateInviteCode();
    const channelId = "channel_" + Date.now();

    const newChannel = new Channel({
      id: channelId,
      name: name.trim(),
      description: description || "",
      image: image || null,
      bgcolor: bgcolor || "#0C3D2B",
      inviteCode: inviteCode,
      inviteLink: `${FRONTEND_URL}/invite/${inviteCode}`,
      isPrivate: isPrivate !== false,
      createdBy: createdBy,
      members: [createdBy],
      createdAt: new Date(),
    });

    await newChannel.save();
    console.log(`✅ Channel created: ${name} (${channelId})`);

    res.json({
      success: true,
      channel: newChannel,
    });
  } catch (error) {
    console.error("Create channel error:", error);

    if (error.code === 11000 || error.name === "MongoError") {
      return res.status(400).json({
        error: `Channel "${name}" already exists. Please choose a different name.`,
      });
    }

    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/channels/direct-message", async (req, res) => {
  try {
    const { userId1, userId2 } = req.body;

    if (!userId1 || !userId2) {
      return res.status(400).json({ error: "Both user IDs are required" });
    }

    const sortedUserIds = [userId1, userId2].sort();
    const dmChannelName = `dm_${sortedUserIds[0]}_${sortedUserIds[1]}`;

    console.log(`🔍 Looking for DM channel: ${dmChannelName}`);

    const existingDM = await Channel.findOne({
      isDM: true,
      name: dmChannelName,
    });

    if (existingDM) {
      console.log(`✅ Found existing DM channel: ${existingDM.id}`);
      return res.json({
        success: true,
        channel: existingDM,
        isNew: false,
      });
    }

    const user1 = await User.findOne({ id: userId1 });
    const user2 = await User.findOne({ id: userId2 });

    if (!user1 || !user2) {
      return res.status(404).json({ error: "One or both users not found" });
    }

    const generateUniqueInviteCode = () => {
      return `dm_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    };

    const inviteCode = generateUniqueInviteCode();

    const dmChannel = new Channel({
      id: "dm_" + Date.now(),
      name: dmChannelName,
      displayName: `${user1.username} & ${user2.username}`,
      description: `Direct message between ${user1.username} and ${user2.username}`,
      isDM: true,
      isPrivate: true,
      createdBy: userId1,
      members: [userId1, userId2],
      participants: [
        {
          userId: userId1,
          username: user1.username,
          image: user1.image,
        },
        {
          userId: userId2,
          username: user2.username,
          image: user2.image,
        },
      ],
      bgcolor: "#1A5D3E",
      inviteCode: inviteCode,
      inviteLink: `${FRONTEND_URL}/invite/${inviteCode}`,
      createdAt: new Date(),
    });

    await dmChannel.save();
    console.log(
      `✅ Created new DM channel: ${dmChannel.id} with invite code: ${inviteCode}`,
    );

    io.emit("dm:channel:created", {
      channel: dmChannel,
      participants: [userId1, userId2],
    });

    res.json({
      success: true,
      channel: dmChannel,
      isNew: true,
    });
  } catch (error: any) {
    console.error("❌ Create DM channel error:", error);

    if (error.code === 11000) {
      try {
        const sortedUserIds = [req.body.userId1, req.body.userId2].sort();
        const dmChannelName = `dm_${sortedUserIds[0]}_${sortedUserIds[1]}`;

        const existingDM = await Channel.findOne({
          isDM: true,
          name: dmChannelName,
        });

        if (existingDM) {
          return res.json({
            success: true,
            channel: existingDM,
            isNew: false,
          });
        }
      } catch (findError) {
        console.error("❌ Error finding existing channel:", findError);
      }

      return res.status(400).json({
        error: "Channel already exists",
        code: "DUPLICATE_CHANNEL",
      });
    }

    res.status(500).json({
      error: "Internal server error",
      details: error.message,
    });
  }
});
app.get("/api/user/:userId/direct-messages", async (req, res) => {
  try {
    const { userId } = req.params;

    const dmChannels = await Channel.find({
      isDM: true,
      members: userId,
    }).sort({ updatedAt: -1 });

    const enrichedChannels = await Promise.all(
      dmChannels.map(async (channel) => {
        const otherParticipantId = channel.members.find((id) => id !== userId);
        const otherUser = await User.findOne({ id: otherParticipantId });

        return {
          ...channel.toObject(),
          otherParticipant: otherUser
            ? {
                id: otherUser.id,
                username: otherUser.username,
                image: otherUser.image,
                isOnline: otherUser.isOnline,
                lastSeen: otherUser.lastSeen,
              }
            : null,
          lastMessage: await Message.findOne({
            channelId: channel.id,
          }).sort({ timestamp: -1 }),
        };
      }),
    );

    res.json({
      success: true,
      channels: enrichedChannels,
    });
  } catch (error) {
    console.error("Get DM channels error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/channels", async (req, res) => {
  try {
    const channels = await Channel.find({});
    res.json(channels);
  } catch (error) {
    console.error("Get channels error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/user/:userId/channels", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const channels = await Channel.find({
      $or: [{ members: userId }, { createdBy: userId }],
    });

    res.json(channels);
  } catch (error) {
    console.error("Get user channels error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.delete("/api/channel/:channelId", async (req, res) => {
  try {
    const { channelId } = req.params;
    const { userId, deletedBy } = req.body;

    console.log(`🗑️ Delete request for channel: ${channelId}`);
    console.log(`👤 User attempting delete: ${userId || deletedBy}`);

    const deletingUser = userId || deletedBy;

    if (!deletingUser) {
      console.log("❌ No user ID provided for deletion");
      return res.status(400).json({ error: "User ID is required" });
    }

    const channel = await Channel.findOne({ id: channelId });
    if (!channel) {
      console.log(`❌ Channel not found: ${channelId}`);
      return res.status(404).json({ error: "Channel not found" });
    }

    console.log(
      `🔍 Channel found: ${channel.name}, Creator: ${channel.createdBy}`,
    );
    console.log(`👤 Deleting user: ${deletingUser}`);

    if (channel.createdBy !== deletingUser) {
      console.log(`❌ Permission denied: ${deletingUser} is not the creator`);
      return res.status(403).json({ error: "Only creator can delete channel" });
    }

    console.log(`✅ Permission granted, proceeding with deletion...`);

    if (channel.image && channel.image.includes("cloudinary.com")) {
      console.log(`🖼️ Deleting channel image from Cloudinary...`);
      await deleteCloudinaryImage(channel.image);
    }

    console.log(`🗑️ Deleting messages for channel: ${channelId}`);
    await Message.deleteMany({ channelId: channelId });

    console.log(`🗑️ Deleting channel: ${channelId}`);
    await Channel.deleteOne({ id: channelId });

    console.log(`✅ Channel successfully deleted: ${channel.name}`);

    io.emit("channel:deleted", {
      channelId: channelId,
      deletedBy: deletingUser,
    });

    res.json({
      success: true,
      message: "Channel deleted successfully",
      channelId: channelId,
    });
  } catch (error) {
    console.error("❌ Delete channel error:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

app.put("/api/channel/:channelId", async (req, res) => {
  try {
    const { channelId } = req.params;
    const { name, description, image, bgcolor, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const channel = await Channel.findOne({ id: channelId });
    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    if (channel.createdBy !== userId) {
      return res.status(403).json({ error: "Only creator can update channel" });
    }

    if (
      image &&
      image !== channel.image &&
      channel.image &&
      channel.image.includes("cloudinary.com")
    ) {
      await deleteCloudinaryImage(channel.image);
    }

    if (name) channel.name = name.trim();
    if (description !== undefined) channel.description = description;
    if (image) channel.image = image;
    if (bgcolor) channel.bgcolor = bgcolor;

    await channel.save();
    console.log(`✅ Channel updated: ${channel.name}`);

    io.emit("channel:updated", channel);

    res.json({ success: true, channel });
  } catch (error) {
    console.error("Update channel error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get(
  "/api/channel/:channelId/messages",
  async (req: Request, res: Response) => {
    try {
      const { channelId } = req.params;
      const { before, limit = "50" } = req.query;

      if (!channelId) {
        return res.status(400).json({
          success: false,
          error: "Channel ID is required",
        });
      }

      const limitNum = parseInt(limit as string);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return res.status(400).json({
          success: false,
          error: "Limit must be between 1 and 100",
        });
      }

      console.log(
        `📥 Fetching messages for channel ${channelId}, before: ${before}, limit: ${limitNum}`,
      );

      let query: any = { channelId };

      if (before && typeof before === "string") {
        const referenceMessage = await Message.findOne({ id: before });
        if (referenceMessage) {
          query.timestamp = { $lt: referenceMessage.timestamp };
          console.log(
            `🔍 Fetching messages before: ${referenceMessage.timestamp}`,
          );
        } else {
          console.log(`❌ Reference message not found: ${before}`);
          return res.json([]);
        }
      }

      const messages = await Message.find(query)
        .sort({ timestamp: 1 })
        .limit(limitNum)
        .exec();

      console.log(
        `✅ Found ${messages.length} messages for channel ${channelId}`,
      );

      res.json(messages);
    } catch (error) {
      console.error("❌ Get messages error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
);

app.delete("/api/message/:messageId", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const message = await Message.findOne({ id: messageId });
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.userId !== userId) {
      return res.status(403).json({ error: "Only sender can delete message" });
    }

    await Message.deleteOne({ id: messageId });
    console.log(`✅ Message deleted: ${messageId}`);

    io.emit("message:deleted", { messageId, channelId: message.channelId });

    res.json({ success: true, message: "Message deleted successfully" });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/api/message/:messageId/seen", async (req, res) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const message = await Message.findOne({ id: messageId });
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const alreadySeen = message.seenBy.some((seen) => seen.userId === userId);

    if (!alreadySeen) {
      message.seenBy.push({
        userId,
        timestamp: new Date(),
      });
      await message.save();

      io.emit("message:seen", {
        messageId,
        userId,
        timestamp: new Date(),
        channelId: message.channelId,
      });
    }

    res.json({ success: true, message: "Message marked as seen" });
  } catch (error) {
    console.error("Mark message seen error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/user/:userId/unseen-count", async (req, res) => {
  try {
    const { userId } = req.params;
    const { channelId } = req.query;

    let query = {
      "seenBy.userId": { $ne: userId },
      userId: { $ne: userId },
    };

    if (channelId) {
      (query as any).channelId = channelId;
    }

    const unseenCount = await Message.countDocuments(query);

    res.json({ success: true, unseenCount });
  } catch (error) {
    console.error("Get unseen count error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/message/:messageId/seen-status", async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findOne({ id: messageId });
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({
      success: true,
      seenBy: message.seenBy,
      totalSeen: message.seenBy.length,
    });
  } catch (error) {
    console.error("Get seen status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/api/allusers", async (req, res) => {
  try {
    const users = await User.find({}, { password: 0 });
    res.json(users);
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/logout", async (req, res) => {
  try {
    const { userId, logoutAllDevices = false } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const user = await User.findOne({ id: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.isOnline = false;
    user.lastSeen = new Date();
    await user.save();

    console.log(`✅ User logged out: ${user.username} (${userId})`);

    io.emit("user:logged-out", {
      userId: userId,
      username: user.username,
      isOnline: false,
      lastSeen: new Date(),
    });

    if (logoutAllDevices) {
      console.log(`🔐 Logged out from all devices: ${user.username}`);
    }

    res.json({
      success: true,
      message: "Logged out successfully",
      userId: userId,
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

  socket.on("authenticate", (userData) => {
    console.log(`🔐 User authenticated: ${userData.username}`);
  });

  socket.on("disconnect", (reason) => {
    console.log(`❌ User disconnected: ${socket.id} - Reason: ${reason}`);
  });

  socket.on("error", (error) => {
    console.error(`💥 Socket error for ${socket.id}:`, error);
  });

  const activeSockets = new Map<string, any>();
  socket.on("friend:request:read", (data) => {
    console.log(`Friend request read by user: ${data.userId}`);
  });

  socket.on("friend:online", async (userId) => {
    try {
      const friendships = await Friends.find({ userId }).populate(
        "friendId",
        "id username image isOnline",
      );

      const onlineFriends = friendships
        .filter((f) => {
          if (typeof f.friendId === "object" && f.friendId !== null) {
            return (f.friendId as any).isOnline;
          }
          return false;
        })
        .map((f) => {
          if (typeof f.friendId === "object" && f.friendId !== null) {
            return f.friendId;
          }
          return null;
        })
        .filter(Boolean);

      socket.emit("friends:online", onlineFriends);
    } catch (error) {
      console.error("Get online friends error:", error);
    }
  });
  socket.on("user:join", async (userData, channelId = "1") => {
    try {
      console.log(`👤 User join event: ${userData.username} (${userData.id})`);

      const user = await User.findOne({ id: userData.id });
      if (!user) {
        console.log(`❌ User not found in database: ${userData.id}`);
        return;
      }

      user.isOnline = true;
      user.lastSeen = new Date();
      await user.save();

      activeSockets.set(socket.id, {
        ...user.toObject(),
        socketId: socket.id,
        currentChannelId: channelId,
      });

      console.log(`✅ User ${user.username} added to active sockets`);

      const userChannels = await Channel.find({
        $or: [{ members: user.id }, { createdBy: user.id }],
      });

      const onlineUsers = await User.find({ isOnline: true }, { password: 0 });

      const channelMessages = await Message.find({ channelId: channelId });

      socket.emit("channel:list", userChannels);
      socket.emit("message:history", channelMessages);
      io.emit("user:online", onlineUsers);

      socket.broadcast.emit(
        "user:joined",
        {
          id: user.id,
          username: user.username,
          email: user.email,
          image: user.image,
          isOnline: true,
        },
        channelId,
      );
    } catch (error) {
      console.error("User join error:", error);
    }
  });
  socket.on("user:deleted", (data) => {
    console.log(`🗑️ User account deleted: ${data.userId}`);

    io.emit("user:deleted", { userId: data.userId });

    const userSockets = Array.from(activeSockets.entries()).filter(
      ([_, userData]) => userData.id === data.userId,
    );

    for (const [socketId, _] of userSockets) {
      io.sockets.sockets.get(socketId)?.disconnect(true);
      activeSockets.delete(socketId);
    }

    console.log(
      `✅ Disconnected ${userSockets.length} sockets for deleted user`,
    );
  });
  socket.on("user:update", async (updatedUser) => {
    try {
      console.log(`🔄 User update received: ${updatedUser.username}`);

      await User.findOneAndUpdate(
        { id: updatedUser.id },
        {
          username: updatedUser.username,
          email: updatedUser.email,
          image: updatedUser.image,
        },
      );

      const activeUser = activeSockets.get(socket.id);
      if (activeUser) {
        Object.assign(activeUser, updatedUser);
      }

      io.emit("user:updated", updatedUser);
    } catch (error) {
      console.error("User update error:", error);
    }
  });
  socket.on("channel:deleted", (data) => {
    console.log(`🗑️ Channel deleted event received: ${data.channelId}`);
  });

  socket.on("channel:join", async (channelId, userId) => {
    try {
      console.log(`👤 Channel join: ${userId} → ${channelId}`);

      const channel = await Channel.findOne({ id: channelId });
      const activeUser = activeSockets.get(socket.id);

      if (!channel || !activeUser) {
        console.log("❌ Channel or user not found");
        return;
      }

      socket.join(`channel-${channelId}`);
      console.log(`✅ Socket joined room: channel-${channelId}`);

      socket.emit("message:history", []);

      const channelMessages = await Message.find({ channelId: channelId }).sort(
        { timestamp: 1 },
      );

      console.log(
        `📤 Sending ${channelMessages.length} messages to ${activeUser.username}`,
      );

      if (channelMessages.length > 0) {
        const firstBatch = channelMessages.slice(0, 20);
        socket.emit("message:history", firstBatch);

        if (channelMessages.length > 20) {
          setTimeout(() => {
            const remainingMessages = channelMessages.slice(20);
            socket.emit("message:batch", {
              channelId,
              messages: remainingMessages,
              batchSize: remainingMessages.length,
            });
          }, 100);
        }
      }
    } catch (error) {
      console.error("❌ Channel join error:", error);
    }
  });

  app.get("/api/user/:userId/unread-by-channel", async (req, res) => {
    try {
      const { userId } = req.params;
      const userChannels = await Channel.find({
        $or: [{ members: userId }, { createdBy: userId }],
      });

      const channelIds = userChannels.map((ch) => ch.id);

      const unreadCounts = await Promise.all(
        channelIds.map(async (channelId) => {
          const count = await Message.countDocuments({
            channelId: channelId,
            userId: { $ne: userId },
            "seenBy.userId": { $ne: userId },
          });
          return { channelId, count };
        }),
      );

      const unreadByChannel = unreadCounts.reduce(
        (acc, { channelId, count }) => {
          acc[channelId] = count;
          return acc;
        },
        {} as Record<string, number>,
      );

      res.json({ success: true, unreadByChannel });
    } catch (error) {
      console.error("Get unread by channel error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  socket.on("message:seen", async (data) => {
    try {
      const { messageId, userId } = data;

      const message = await Message.findOne({ id: messageId });
      if (!message) return;

      const alreadySeen = message.seenBy.some((seen) => seen.userId === userId);

      if (!alreadySeen) {
        message.seenBy.push({
          userId,
          timestamp: new Date(),
        });
        await message.save();

        io.emit("message:seen", {
          messageId,
          userId,
          timestamp: new Date(),
          channelId: message.channelId,
        });

        const unreadCount = await Message.countDocuments({
          channelId: message.channelId,
          userId: { $ne: userId },
          "seenBy.userId": { $ne: userId },
        });

        io.to(`user-${userId}`).emit("unread:update", {
          channelId: message.channelId,
          count: unreadCount,
        });
      }
    } catch (error) {
      console.error("Message seen error:", error);
    }
  });

  interface BatchedMessage {
    id: string;
    content: string;
    userId: string;
    username: string;
    channelId: string;
    userImage?: string;
    type: "text" | "image" | "file" | "gif";
    timestamp: Date | string;
    seenBy?: Array<{ userId: string; timestamp: Date }>;
  }

  let messageBatch: BatchedMessage[] = [];
  let batchTimeout: NodeJS.Timeout | null = null;

  const flushMessageBatch = () => {
    if (messageBatch.length > 0) {
      console.log(`📦 Flushing batch of ${messageBatch.length} messages`);

      const messagesByChannel: { [channelId: string]: BatchedMessage[] } =
        messageBatch.reduce(
          (acc, message) => {
            if (!acc[message.channelId]) {
              acc[message.channelId] = [];
            }
            acc[message.channelId].push(message);
            return acc;
          },
          {} as { [channelId: string]: BatchedMessage[] },
        );

      Object.entries(messagesByChannel).forEach(([channelId, messages]) => {
        io.emit("message:batch", {
          channelId,
          messages,
          batchSize: messages.length,
        });
      });

      messageBatch = [];
    }
    batchTimeout = null;
  };

  socket.on("message:send", async (messageData) => {
    try {
      const startTime = Date.now();
      const activeUser = activeSockets.get(socket.id);

      if (!activeUser) {
        console.log("❌ Message rejected: User not found in activeSockets");
        socket.emit("error", { message: "User session not found" });
        return;
      }

      const channel = await Channel.findOne({ id: messageData.channelId });
      if (
        !channel ||
        (!channel.members.includes(activeUser.id) &&
          channel.createdBy !== activeUser.id)
      ) {
        console.log("❌ Message rejected: User not a member of channel");
        socket.emit("error", { message: "Not a channel member" });
        return;
      }

      let message;

      if (messageData.id) {
        message = await Message.findOne({ id: messageData.id });
        if (!message || message.userId !== activeUser.id) {
          console.log("❌ Edit rejected: unauthorized");
          socket.emit("error", { message: "Cannot edit this message" });
          return;
        }
        message.content = messageData.content;
        await message.save();
        console.log(`✏️ Message edited: ${message.id}`);

        io.emit("message:updated", {
          id: message.id,
          content: message.content,
          userId: message.userId,
          username: message.username,
          channelId: message.channelId,
          type: message.type,
          timestamp: message.timestamp,
        });
      } else {
        message = new Message({
          id: uuidv4(),
          content: messageData.content,
          userId: activeUser.id,
          username: activeUser.username,
          channelId: messageData.channelId,
          userImage: activeUser.image,
          type: messageData.type || "text",
          timestamp: new Date(),
        }) as BatchedMessage;
        await message.save();

        const messageType = messageData.type?.toUpperCase() || "TEXT";
        console.log(
          `💬 ${messageType} message from ${activeUser.username} in channel ${messageData.channelId}`,
        );

        socket.emit("message:receive", message);
        console.log(`✅ Message sent back to sender: ${activeUser.username}`);

        messageBatch.push(message);
        console.log(`📥 Added to batch. Batch size: ${messageBatch.length}`);

        if (messageBatch.length >= 3) {
          if (batchTimeout) {
            clearTimeout(batchTimeout);
            batchTimeout = null;
          }
          flushMessageBatch();
        } else if (!batchTimeout) {
          batchTimeout = setTimeout(flushMessageBatch, 50);
        }

        if (!messageData.id) {
          const otherMembers = channel.members.filter(
            (memberId) => memberId !== activeUser.id,
          );

          for (const memberId of otherMembers) {
            const unreadCount = await Message.countDocuments({
              channelId: messageData.channelId,
              userId: { $ne: memberId },
              "seenBy.userId": { $ne: memberId },
            });

            io.to(`user-${memberId}`).emit("unread:update", {
              channelId: messageData.channelId,
              count: unreadCount,
            });
          }
        }
      }

      const endTime = Date.now();
      console.log(`⏱️ Message processing took ${endTime - startTime}ms`);
    } catch (error) {
      console.error("❌ Message send error:", error);
      socket.emit("error", { message: "Failed to send message" });

      if (batchTimeout) {
        clearTimeout(batchTimeout);
        batchTimeout = null;
      }
      messageBatch = [];
    }
  });

  const forceFlushMessageBatch = () => {
    if (batchTimeout) {
      clearTimeout(batchTimeout);
      batchTimeout = null;
    }
    flushMessageBatch();
  };

  socket.on("disconnect", () => {
    forceFlushMessageBatch();
  });

  socket.on("user:switchChannel", () => {
    forceFlushMessageBatch();
  });

  socket.on("message:edited", async (messageData) => {
    try {
      console.log(`📝 Edit request received for message: ${messageData.id}`);

      const activeUser = activeSockets.get(socket.id);
      if (!activeUser) {
        console.error("❌ User not found for edit");
        socket.emit("error", { message: "User session not found" });
        return;
      }

      const message = await Message.findOne({ id: messageData.id });
      if (!message) {
        console.error(`❌ Message not found: ${messageData.id}`);
        socket.emit("error", { message: "Message not found" });
        return;
      }

      if (message.userId !== activeUser.id) {
        console.error(`❌ Unauthorized edit attempt by ${activeUser.id}`);
        socket.emit("error", { message: "Cannot edit this message" });
        return;
      }

      message.content = messageData.content;
      await message.save();
      console.log(`✅ Message updated: ${message.id}`);

      io.emit("message:updated", {
        id: message.id,
        content: message.content,
        userId: message.userId,
        username: message.username,
        channelId: message.channelId,
        type: message.type,
        timestamp: message.timestamp,
      });

      console.log(
        `📡 Update broadcast sent to all clients for message ${message.id}`,
      );
    } catch (error) {
      console.error("❌ Edit message error:", error);
      socket.emit("error", { message: "Failed to edit message" });
    }
  });

  socket.on("user:typing", (typingData) => {
    console.log(`⌨️  ${typingData.username} is typing...`);

    socket.broadcast.emit("user:typing", {
      ...typingData,
      isTyping: true,
    });

    setTimeout(() => {
      socket.broadcast.emit("user:typing", {
        ...typingData,
        isTyping: false,
      });
    }, 3000);
  });

  socket.on("user:switchChannel", async (userId, newChannelId) => {
    try {
      const activeUser = activeSockets.get(socket.id);
      if (activeUser) {
        activeUser.currentChannelId = newChannelId;

        const onlineUsers = await User.find(
          { isOnline: true },
          { password: 0 },
        );
        io.emit("user:online", onlineUsers);
      }
    } catch (error) {
      console.error("Switch channel error:", error);
    }
  });
  socket.on("user:identify", (userId: string) => {
    socket.join(`user-${userId}`);
    console.log(`✅ User ${userId} joined room user-${userId}`);
  });

  socket.on("webrtc:call-offer", (data) => {
    console.log("📞 Call offer received:", {
      from: data.from,
      to: data.to,
      audioOnly: data.audioOnly,
      fromImage: data.fromImage,
      isDMChannel: data.isDMChannel,
      isChannelCall: data.isChannelCall,
    });

    io.to(`user-${data.to}`).emit("webrtc:call-offer", {
      ...data,
      isDMChannel: data.isDMChannel || false,
      channelImage: data.channelImage || "",
      channelName: data.channelName || "",
    });
  });

  socket.on("webrtc:call-answer", (data) => {
    console.log("✅ Call answer received:", {
      from: data.from,
      to: data.to,
      fromImage: data.fromImage,
      isChannelCall: data.isChannelCall,
      isDMChannel: data.isDMChannel,
    });

    io.to(`user-${data.to}`).emit("webrtc:call-answer", {
      ...data,
      isDMChannel: data.isDMChannel || false,
    });
  });

  socket.on("webrtc:ice-candidate", (data) => {
    console.log(`🧊 ICE candidate from ${data.from} to ${data.to}`, {
      isChannelCall: data.isChannelCall,
      isDMChannel: data.isDMChannel,
    });

    io.to(`user-${data.to}`).emit("webrtc:ice-candidate", {
      candidate: data.candidate,
      from: data.from,
      fromUsername: data.fromUsername,
      fromImage: data.fromImage,
      isChannelCall: data.isChannelCall,
      channelId: data.channelId,
      isDMChannel: data.isDMChannel || false,
    });
  });

  socket.on("webrtc:call-end", (data) => {
    socket.broadcast.emit("webrtc:call-end", { from: data.from });
  });

  socket.on("webrtc:call-reject", (data) => {
    io.to(`user-${data.to}`).emit("webrtc:call-reject", { from: data.from });
  });

  socket.on("disconnect", async (reason) => {
    try {
      const activeUser = activeSockets.get(socket.id);
      if (activeUser) {
        console.log(
          `❌ User disconnected: ${activeUser.username} (${socket.id}) - Reason: ${reason}`,
        );

        const userActiveConnections = Array.from(
          activeSockets.entries(),
        ).filter(([_, userData]) => userData.id === activeUser.id);

        if (userActiveConnections.length <= 1) {
          await User.findOneAndUpdate(
            { id: activeUser.id },
            {
              isOnline: false,
              lastSeen: new Date(),
            },
          );

          socket.broadcast.emit(
            "user:left",
            {
              id: activeUser.id,
              username: activeUser.username,
              email: activeUser.email,
              image: activeUser.image,
              isOnline: false,
              lastSeen: new Date(),
            },
            activeUser.currentChannelId || "1",
          );

          console.log(`📢 Broadcasted user offline: ${activeUser.username}`);
        }

        activeSockets.delete(socket.id);

        const onlineUsers = await User.find(
          { isOnline: true },
          { password: 0 },
        );
        io.emit("user:online", onlineUsers);
      } else {
        console.log(
          `❌ Socket disconnected: ${socket.id} (no user found) - Reason: ${reason}`,
        );
      }
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  });
});
app.get("/api/link-preview", async (req: Request, res: Response) => {
  let abortController: AbortController | null = null;

  try {
    const { url } = req.query;

    if (!url || typeof url !== "string") {
      return res
        .status(400)
        .json({ error: "URL parameter is required and must be a string" });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const allowedProtocols = ["http:", "https:"];
    if (!allowedProtocols.includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: "Invalid URL protocol" });
    }

    const blockedDomains = ["localhost", "127.0.0.1", "0.0.0.0", "internal"];
    if (blockedDomains.some((domain) => parsedUrl.hostname.includes(domain))) {
      return res.status(400).json({ error: "Domain not allowed" });
    }

    abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController?.abort();
    }, 10000);

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkPreviewBot/1.0)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("text/html")) {
      throw new Error("URL does not return HTML content");
    }

    const html = await response.text();

    const getMetaContent = (property: string): string | null => {
      const regex = new RegExp(
        `<meta[^>]*(property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
        "i",
      );
      const match = html.match(regex);
      return match ? match[2] : null;
    };

    const getTitle = (): string | null => {
      const ogTitle = getMetaContent("og:title");
      if (ogTitle) return ogTitle;

      const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      return titleMatch ? titleMatch[1].trim() : null;
    };

    const getDescription = (): string | null => {
      const ogDesc = getMetaContent("og:description");
      if (ogDesc) return ogDesc;

      const twitterDesc = getMetaContent("twitter:description");
      if (twitterDesc) return twitterDesc;

      return getMetaContent("description");
    };

    const getImage = (): string | null => {
      const ogImage = getMetaContent("og:image");
      if (ogImage) {
        try {
          return new URL(ogImage, parsedUrl.origin).toString();
        } catch {
          return ogImage;
        }
      }

      const twitterImage = getMetaContent("twitter:image");
      if (twitterImage) {
        try {
          return new URL(twitterImage, parsedUrl.origin).toString();
        } catch {
          return twitterImage;
        }
      }

      return null;
    };

    const getSiteName = (): string | null => {
      const ogSiteName = getMetaContent("og:site_name");
      if (ogSiteName) return ogSiteName;

      const twitterSite = getMetaContent("twitter:site");
      if (twitterSite) return twitterSite.replace("@", "");

      return parsedUrl.hostname.replace("www.", "");
    };

    const title = getTitle();
    const description = getDescription();
    const image = getImage();
    const siteName = getSiteName();

    res.json({
      title: title ? title.trim().substring(0, 200) : null,
      description: description ? description.trim().substring(0, 300) : null,
      image,
      siteName: siteName ? siteName.trim() : null,
      url: parsedUrl.toString(),
    });
  } catch (error: any) {
    console.error("Link preview error:", error);

    if (error.name === "AbortError") {
      return res.status(408).json({
        error: "Request timeout",
        details: "The website took too long to respond",
      });
    }

    res.status(500).json({
      error: "Failed to fetch link preview",
      details: error.message || "Unknown error",
    });
  }
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket ready for connections`);
  console.log(`🌐 CORS enabled for: ${FRONTEND_URL}`);
});
