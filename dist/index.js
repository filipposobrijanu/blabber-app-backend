"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const uuid_1 = require("uuid");
const cloudinary_1 = require("cloudinary");
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const google_auth_library_1 = require("google-auth-library");
const resend_1 = require("resend");
dotenv_1.default.config();
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
const googleClient = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${process.env.FRONTEND_URL}/auth/google/callback`);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/blabber";
mongoose_1.default
    .connect(MONGODB_URI)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
});
// MongoDB Schemas
const userSchema = new mongoose_1.default.Schema({
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
    googleId: { type: String, unique: true, sparse: true }, // sparse allows multiple nulls
}, { timestamps: true });
const friendRequestSchema = new mongoose_1.default.Schema({
    id: { type: String, required: true, unique: true },
    fromUserId: {
        type: String,
        required: true,
        ref: "User", // ✅ ADD THIS to enable population
    },
    toUserId: {
        type: String,
        required: true,
        ref: "User", // ✅ ADD THIS to enable population
    },
    status: {
        type: String,
        enum: ["pending", "accepted", "rejected", "blocked"],
        default: "pending",
    },
    createdAt: { type: Date, default: Date.now },
}, { timestamps: true });
const friendsSchema = new mongoose_1.default.Schema({
    id: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    friendId: { type: String, required: true },
    friendsSince: { type: Date, default: Date.now },
}, { timestamps: true });
const FriendRequest = mongoose_1.default.model("FriendRequest", friendRequestSchema);
const Friends = mongoose_1.default.model("Friends", friendsSchema);
const channelSchema = new mongoose_1.default.Schema({
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
}, { timestamps: true });
const messageSchema = new mongoose_1.default.Schema({
    id: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    userId: { type: String, required: true },
    username: { type: String, required: true },
    userImage: { type: String }, // ADD THIS FIELD
    channelId: { type: String, required: true },
    type: {
        type: String,
        default: "text",
        enum: ["text", "image", "file", "gif"], // ADD "gif" HERE
    },
    timestamp: { type: Date, default: Date.now },
    seenBy: [
        {
            // ADD THIS
            userId: { type: String, required: true },
            timestamp: { type: Date, default: Date.now },
        },
    ],
    deliveredTo: [{ type: String }], // Optional: track delivery
}, { timestamps: true });
const User = mongoose_1.default.model("User", userSchema);
const Channel = mongoose_1.default.model("Channel", channelSchema);
const Message = mongoose_1.default.model("Message", messageSchema);
const FRONTEND_URL = process.env.NODE_ENV === "production"
    ? "https://blabber-chat.netlify.app"
    : "http://localhost:3000";
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const sendEmail = async (to, subject, html) => {
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
    }
    catch (error) {
        console.error("❌ Email failed:", error);
        return false;
    }
};
// Request logging
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.path}`, {
        ip: req.ip,
        origin: req.headers.origin,
        timestamp: new Date().toISOString(),
    });
    next();
});
// Root route - FIXES "Cannot GET /"
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
// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "OK",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
    });
});
// Test endpoint
// Test endpoint - FIXED FOR MONGODB
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
    }
    catch (error) {
        res.json({
            message: "API is working but MongoDB might have issues",
            timestamp: new Date().toISOString(),
        });
    }
});
const io = new socket_io_1.Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ["GET", "POST"],
        credentials: true,
    },
    // ADD THESE OPTIONS FOR v4 COMPATIBILITY
    connectTimeout: 45000,
    pingTimeout: 20000,
    pingInterval: 25000,
    transports: ["websocket", "polling"],
});
app.use((0, cors_1.default)({
    origin: FRONTEND_URL,
    credentials: true,
}));
app.use(express_1.default.json({ limit: "10mb" }));
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
        // ✅ EMIT WITH COMPLETE USER DATA
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
    }
    catch (error) {
        console.error("Send friend request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
app.get("/api/friends/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const friendships = await Friends.find({ userId });
        // Manually fetch user data since we can't use populate with string IDs
        const friends = await Promise.all(friendships.map(async (friendship) => {
            const friendUser = await User.findOne({ id: friendship.friendId }, { password: 0, resetToken: 0, resetTokenExpiry: 0 });
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
        }));
        console.log(`📥 Fetched ${friends.length} friends for user ${userId}`);
        res.json({
            success: true,
            friends,
        });
    }
    catch (error) {
        console.error("Get friends error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ✅ FIXED: GET FRIEND REQUESTS (NO POPULATE - MANUAL FETCH)
app.get("/api/friends/requests/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        console.log(`📥 Fetching friend requests for user: ${userId}`);
        // Get pending requests
        const pendingRequests = await FriendRequest.find({
            toUserId: userId,
            status: "pending",
        });
        console.log(`Found ${pendingRequests.length} pending requests`);
        // Manually fetch user data for each request
        const transformedRequests = await Promise.all(pendingRequests.map(async (request) => {
            const fromUser = await User.findOne({ id: request.fromUserId }, { password: 0, resetToken: 0, resetTokenExpiry: 0 });
            console.log(`Request from ${request.fromUserId}:`, fromUser ? `Found user: ${fromUser.username}` : "User not found");
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
        }));
        console.log(`✅ Returning ${transformedRequests.length} friend requests`, transformedRequests);
        res.json({
            success: true,
            requests: transformedRequests,
        });
    }
    catch (error) {
        console.error("❌ Get friend requests error:", error);
        res.status(500).json({
            error: "Internal server error",
            details: error.message,
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
        // Create bidirectional friendship
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
        // ✅ EMIT WITH COMPLETE DATA
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
    }
    catch (error) {
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
    }
    catch (error) {
        console.error("Reject friend request error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
app.delete("/api/friends/remove", async (req, res) => {
    try {
        const { userId, friendId } = req.body;
        // Remove both directions of friendship
        await Friends.deleteMany({
            $or: [
                { userId, friendId },
                { userId: friendId, friendId: userId },
            ],
        });
        // Also delete any friend requests between them
        await FriendRequest.deleteMany({
            $or: [
                { fromUserId: userId, toUserId: friendId },
                { fromUserId: friendId, toUserId: userId },
            ],
        });
        // Emit real-time update
        io.emit("friend:removed", {
            userId,
            friendId,
        });
        res.json({
            success: true,
            message: "Friend removed successfully",
        });
    }
    catch (error) {
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
        const users = await User.find({
            $and: [
                {
                    $or: [
                        { username: { $regex: query, $options: "i" } },
                        { email: { $regex: query, $options: "i" } },
                    ],
                },
                { id: { $ne: currentUserId } }, // Exclude current user
            ],
        }, { password: 0 });
        res.json({
            success: true,
            users,
        });
    }
    catch (error) {
        console.error("Search users error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Google OAuth callback endpoint
// Google OAuth callback endpoint - ΕΠΕΚΤΕΙΝΗΜΕΝΟ
// Google OAuth callback endpoint - UPDATED WITH CLOUDINARY UPLOAD
app.post("/api/auth/google", async (req, res) => {
    try {
        const { code, mode = "login" } = req.body;
        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Authorization code is required",
            });
        }
        // Exchange code for tokens
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
        // Verify the ID token
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
        // Extract user information
        const { sub: googleId, email, name, picture, given_name, family_name, } = payload;
        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required from Google",
            });
        }
        // Check if user exists in database
        let user = await User.findOne({
            $or: [{ email: email.toLowerCase() }, { googleId: googleId }],
        });
        // ✅ KEY FIX: If user doesn't exist and mode is LOGIN, send needsSignup
        if (!user && mode === "login") {
            return res.status(401).json({
                success: false,
                message: "No account found with this Google account. Please sign up first.",
                needsSignup: true,
                email: email,
            });
        }
        if (!user) {
            // SIGNUP MODE - Create new user
            const baseUsername = email
                .split("@")[0]
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, "");
            let username = baseUsername;
            let counter = 1;
            // Ensure username is unique
            while (await User.findOne({ username })) {
                username = `${baseUsername}${counter}`;
                counter++;
            }
            let userImage = `https://ui-avatars.com/api/?name=${encodeURIComponent(name || username)}&background=random&color=000000&bold=true`;
            // ✅ NEW: Upload Google profile picture to Cloudinary if available
            if (picture) {
                try {
                    console.log(`📤 Uploading Google profile image to Cloudinary for ${email}`);
                    // Upload the Google image to Cloudinary
                    const uploadResult = await cloudinary_1.v2.uploader.upload(picture, {
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
                }
                catch (uploadError) {
                    console.error("❌ Failed to upload Google image to Cloudinary:", uploadError);
                    // Fall back to the original Google picture URL if upload fails
                    userImage = picture;
                    console.log(`⚠️ Using original Google image URL: ${userImage}`);
                }
            }
            // Create new user with Google data
            user = new User({
                id: "user_" + Date.now(),
                username: username,
                email: email.toLowerCase(),
                password: await bcrypt_1.default.hash(Math.random().toString(36) + Date.now().toString(), 12),
                image: userImage, // Use the Cloudinary URL or fallback
                isOnline: true,
                lastSeen: new Date(),
                googleId: googleId,
                dateOfBirth: new Date(Date.now() - 13 * 365 * 24 * 60 * 60 * 1000),
            });
            await user.save();
            console.log(`✅ New Google user registered: ${username} (${email})`);
            // Send welcome email
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
                }
                catch (emailError) {
                    console.log("⚠️ Failed to send welcome email to Google user:", emailError);
                }
            }, 0);
        }
        else if (user) {
            // LOGIN MODE - Update existing user and potentially update profile picture
            user.googleId = googleId;
            // ✅ NEW: Update profile picture to Cloudinary if it's still the Google URL
            if (picture && user.image === picture) {
                try {
                    console.log(`📤 Updating existing Google user image to Cloudinary for ${email}`);
                    const uploadResult = await cloudinary_1.v2.uploader.upload(picture, {
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
                    console.log(`✅ Existing Google image uploaded to Cloudinary: ${user.image}`);
                }
                catch (uploadError) {
                    console.error("❌ Failed to upload existing Google image to Cloudinary:", uploadError);
                    // Keep the current image if upload fails
                }
            }
            else if (picture && user.image !== picture) {
                // If the Google picture changed, update it
                user.image = picture;
            }
            user.isOnline = true;
            user.lastSeen = new Date();
            await user.save();
            console.log(`✅ Google user logged in: ${user.username} (${email})`);
        }
        // Return user data
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
            isNewUser: !user.createdAt ||
                Date.now() - new Date(user.createdAt).getTime() < 60000,
        });
    }
    catch (error) {
        console.error("Google OAuth error:", error);
        res.status(401).json({
            success: false,
            message: `Google ${req.body.mode || "authentication"} failed`,
        });
    }
});
// In-memory storage
// const users = new Map<string, any>();
// const registeredUsers = new Map<string, any>();
// const channels: any[] = [];
// const messages: any[] = [];
// Helper function to generate invite code
const generateInviteCode = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
};
// Configure Cloudinary - FIXED
try {
    cloudinary_1.v2.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    console.log("✅ Cloudinary configured successfully");
}
catch (error) {
    console.error("❌ Cloudinary configuration failed:", error);
}
// ADD THIS HELPER FUNCTION FOR DELETING CLOUDINARY IMAGES
const deleteCloudinaryImage = async (imageUrl) => {
    try {
        if (!imageUrl || !imageUrl.includes("cloudinary.com")) {
            console.log("⚠️ Not a Cloudinary URL, skipping deletion:", imageUrl);
            return true; // Return true for non-Cloudinary URLs (like ui-avatars)
        }
        // Extract public ID from Cloudinary URL
        // Cloudinary URLs format: https://res.cloudinary.com/cloudname/image/upload/v1234567/folder/filename.jpg
        const url = new URL(imageUrl);
        const pathParts = url.pathname.split("/");
        // Find the index after 'upload'
        const uploadIndex = pathParts.indexOf("upload");
        if (uploadIndex === -1) {
            console.log("❌ Invalid Cloudinary URL format");
            return false;
        }
        // Get everything after 'upload' and remove version prefix (v1234567/)
        const pathAfterUpload = pathParts.slice(uploadIndex + 1).join("/");
        const publicId = pathAfterUpload
            .replace(/^v\d+\//, "")
            .replace(/\.[^/.]+$/, "");
        console.log(`🗑️ Attempting to delete Cloudinary image: ${publicId}`);
        const result = await cloudinary_1.v2.uploader.destroy(publicId);
        if (result.result === "ok") {
            console.log(`✅ Successfully deleted: ${publicId}`);
            return true;
        }
        else {
            console.log(`❌ Cloudinary deletion failed: ${publicId}`, result);
            return false;
        }
    }
    catch (error) {
        console.error("Error deleting Cloudinary image:", error);
        return false;
    }
};
// Add upload endpoint for channel images
// Simple upload endpoint without multer
// Add this endpoint for message images
app.post("/api/upload/message-image", express_1.default.json({ limit: "10mb" }), async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({
                success: false,
                message: "No image data provided",
            });
        }
        // Upload to Cloudinary
        const result = await cloudinary_1.v2.uploader.upload(image, {
            folder: "blabber/messages",
            quality: "auto:good",
            fetch_format: "auto",
        });
        console.log("Message image uploaded to Cloudinary:", result.secure_url);
        res.json({
            success: true,
            image_url: result.secure_url,
        });
    }
    catch (error) {
        console.error("Message image upload error:", error);
        res.status(500).json({
            success: false,
            message: "Upload failed: " + error.message,
        });
    }
});
app.post("/api/upload/channel-image", express_1.default.json({ limit: "10mb" }), async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({
                success: false,
                message: "No image data provided",
            });
        }
        // Upload to Cloudinary with better quality
        const result = await cloudinary_1.v2.uploader.upload(image, {
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
    }
    catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            message: "Upload failed: " + error.message,
        });
    }
});
// Channel Settings Endpoints
// Get channel members
app.get("/api/channel/:channelId/members", async (req, res) => {
    try {
        const { channelId } = req.params;
        const channel = await Channel.findOne({ id: channelId });
        if (!channel) {
            return res.status(404).json({ error: "Channel not found" });
        }
        // Get all members with their user data
        const members = await User.find({ id: { $in: channel.members } }, { password: 0, resetToken: 0, resetTokenExpiry: 0 });
        res.json({ success: true, members });
    }
    catch (error) {
        console.error("Get channel members error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Add member to channel
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
        // Check if user has permission to add members
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
        // Add user to channel members
        channel.members.push(userToAdd.id);
        await channel.save();
        console.log(`✅ User ${userToAdd.username} added to channel ${channel.name}`);
        // Broadcast channel update
        io.emit("channel:updated", channel);
        res.json({
            success: true,
            message: `${userToAdd.username} added to channel successfully`,
        });
    }
    catch (error) {
        console.error("Add member error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Remove member from channel
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
        // Check if user has permission to remove members
        if (channel.createdBy !== removedBy) {
            return res
                .status(403)
                .json({ error: "Only channel creator can remove members" });
        }
        // Prevent removing the creator
        if (memberId === channel.createdBy) {
            return res.status(400).json({ error: "Cannot remove channel creator" });
        }
        if (!channel.members.includes(memberId)) {
            return res
                .status(400)
                .json({ error: "User is not a member of this channel" });
        }
        // Remove user from channel members
        channel.members = channel.members.filter((id) => id !== memberId);
        await channel.save();
        console.log(`✅ User ${memberId} removed from channel ${channel.name}`);
        // Broadcast channel update
        io.emit("channel:updated", channel);
        res.json({
            success: true,
            message: "Member removed from channel successfully",
        });
    }
    catch (error) {
        console.error("Remove member error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Leave channel
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
        // Prevent creator from leaving (they should delete the channel instead)
        if (channel.createdBy === userId) {
            return res.status(400).json({
                error: "Channel creator cannot leave. Please delete the channel instead.",
            });
        }
        if (!channel.members.includes(userId)) {
            return res
                .status(400)
                .json({ error: "You are not a member of this channel" });
        }
        // Remove user from channel members
        channel.members = channel.members.filter((id) => id !== userId);
        await channel.save();
        console.log(`✅ User ${userId} left channel ${channel.name}`);
        // Broadcast channel update
        io.emit("channel:updated", channel);
        // Also emit specific leave event
        io.emit("user:left-channel", { channelId, userId });
        res.json({
            success: true,
            message: "You have left the channel successfully",
        });
    }
    catch (error) {
        console.error("Leave channel error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Update channel settings
// Update channel settings endpoint - MAKE IT MORE FLEXIBLE
app.put("/api/channel/:channelId/settings", async (req, res) => {
    try {
        const { channelId } = req.params;
        const { name, description, image, bgcolor, isPrivate, updatedBy, userId } = req.body;
        // Use either updatedBy or userId
        const updatingUser = updatedBy || userId;
        if (!updatingUser) {
            return res.status(400).json({ error: "User ID is required" });
        }
        const channel = await Channel.findOne({ id: channelId });
        if (!channel) {
            return res.status(404).json({ error: "Channel not found" });
        }
        // Check if user has permission to update
        if (channel.createdBy !== updatingUser) {
            return res
                .status(403)
                .json({ error: "Only channel creator can update settings" });
        }
        // Delete old image if it's being changed
        if (image &&
            image !== channel.image &&
            channel.image &&
            channel.image.includes("cloudinary.com")) {
            await deleteCloudinaryImage(channel.image);
        }
        // Update channel data
        if (name)
            channel.name = name.trim();
        if (description !== undefined)
            channel.description = description;
        if (image)
            channel.image = image;
        if (bgcolor)
            channel.bgcolor = bgcolor;
        if (isPrivate !== undefined)
            channel.isPrivate = isPrivate;
        await channel.save();
        console.log(`✅ Channel settings updated: ${channel.name}`);
        // Broadcast channel update to all clients
        io.emit("channel:updated", channel);
        res.json({
            success: true,
            channel: channel,
            message: "Channel settings updated successfully",
        });
    }
    catch (error) {
        console.error("Update channel settings error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Get channel by ID
// Update channel
app.put("/api/channel/:channelId", async (req, res) => {
    try {
        const { channelId } = req.params;
        const { name, description, image, bgcolor, userId, updatedBy } = req.body;
        // Use either userId or updatedBy
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
        if (image &&
            image !== channel.image &&
            channel.image &&
            channel.image.includes("cloudinary.com")) {
            await deleteCloudinaryImage(channel.image);
        }
        if (name)
            channel.name = name.trim();
        if (description !== undefined)
            channel.description = description;
        if (image)
            channel.image = image;
        if (bgcolor)
            channel.bgcolor = bgcolor;
        await channel.save();
        console.log(`✅ Channel updated: ${channel.name}`);
        io.emit("channel:updated", channel);
        res.json({ success: true, channel });
    }
    catch (error) {
        console.error("Update channel error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Update user profile endpoint
// Update user profile endpoint - UPDATED WITH AVATAR DELETE
// Update user profile endpoint - FIXED FOR MONGODB
app.put("/api/user/profile", async (req, res) => {
    try {
        const { userId, username, email, image } = req.body;
        if (!userId) {
            return res.status(400).json({ error: "User ID is required" });
        }
        // Find user in MongoDB
        const user = await User.findOne({ id: userId });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        // Check if avatar is being changed and delete old one
        if (image &&
            image !== user.image &&
            user.image &&
            !user.image.includes("ui-avatars.com")) {
            console.log(`🔄 Avatar changed in profile update, deleting previous: ${user.image}`);
            await deleteCloudinaryImage(user.image);
        }
        // Check if username is already taken by another user
        if (username && username !== user.username) {
            const existingUsername = await User.findOne({
                username: username.trim().toLowerCase(),
                id: { $ne: userId }, // Exclude current user
            });
            if (existingUsername) {
                return res.status(400).json({ error: "Username already taken" });
            }
        }
        // Check if email is already taken by another user
        if (email && email !== user.email) {
            const existingEmail = await User.findOne({
                email: email.trim().toLowerCase(),
                id: { $ne: userId }, // Exclude current user
            });
            if (existingEmail) {
                return res.status(400).json({ error: "Email already taken" });
            }
        }
        // Update user data
        if (username)
            user.username = username.trim();
        if (email)
            user.email = email.trim().toLowerCase();
        if (image)
            user.image = image;
        await user.save();
        console.log(`✅ User profile updated: ${user.username} (${user.id})`);
        // Broadcast user update to all connected clients
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
    }
    catch (error) {
        console.error("Profile update error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Add this in your Socket.IO connection handling section, after the other event handlers
// Change password endpoint
// Change password endpoint - FIXED FOR MONGODB
// Change password endpoint - UPDATED WITH PASSWORD HASHING
app.put("/api/user/change-password", async (req, res) => {
    try {
        const { userId, currentPassword, newPassword } = req.body;
        if (!userId || !currentPassword || !newPassword) {
            return res.status(400).json({ error: "All fields are required" });
        }
        // Find user in MongoDB
        const user = await User.findOne({ id: userId });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        // VERIFY CURRENT PASSWORD WITH BCRYPT - REPLACE THIS SECTION
        const isCurrentPasswordValid = await bcrypt_1.default.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({ error: "Current password is incorrect" });
        }
        // Validate new password strength
        const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({
                error: "Password must be at least 6 characters with letters and numbers",
            });
        }
        // HASH THE NEW PASSWORD - ADD THIS SECTION
        const saltRounds = 12;
        const hashedPassword = await bcrypt_1.default.hash(newPassword, saltRounds);
        // Update password
        user.password = hashedPassword; // CHANGED: Store hashed password
        await user.save();
        console.log(`✅ Password changed for user: ${user.username}`);
        res.json({
            success: true,
            message: "Password changed successfully",
        });
    }
    catch (error) {
        console.error("Change password error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Upload user avatar endpoint
// Upload user avatar endpoint - UPDATED WITH DELETE FUNCTIONALITY
// Upload user avatar endpoint - FIXED FOR MONGODB
app.post("/api/upload/user-avatar", express_1.default.json({ limit: "10mb" }), async (req, res) => {
    try {
        const { image, userId } = req.body;
        if (!image || !userId) {
            return res.status(400).json({
                success: false,
                message: "Image data and user ID are required",
            });
        }
        // Find user in MongoDB
        const user = await User.findOne({ id: userId });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }
        const currentAvatarUrl = user.image;
        let deleteSuccess = true;
        // Delete previous avatar if it's not the default UI Avatars one
        if (currentAvatarUrl && !currentAvatarUrl.includes("ui-avatars.com")) {
            console.log(`🔄 Deleting previous avatar for user ${userId}`);
            deleteSuccess = await deleteCloudinaryImage(currentAvatarUrl);
            if (!deleteSuccess) {
                console.log("⚠️ Failed to delete previous avatar, but continuing with upload...");
            }
        }
        // Upload new avatar to Cloudinary with better quality settings
        const result = await cloudinary_1.v2.uploader.upload(image, {
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
        // Update user's image in MongoDB
        user.image = result.secure_url;
        await user.save();
        // Broadcast user update
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
    }
    catch (error) {
        console.error("Avatar upload error:", error);
        res.status(500).json({
            success: false,
            message: "Upload failed: " + error.message,
        });
    }
});
// User registration endpoint
// User registration endpoint
// User registration endpoint
app.post("/api/register", async (req, res) => {
    try {
        const { username, email, password, image, dateOfBirth } = req.body; // ADD dateOfBirth
        // Input validation
        if (!username || !email || !password || !dateOfBirth) {
            // ADD dateOfBirth check
            return res.status(400).json({ error: "All fields are required" });
        }
        // Validate age (at least 13 years old)
        const birthDate = new Date(dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 ||
            (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
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
                error: "Username must be 4-20 characters and can only contain letters, numbers, and underscores",
            });
        }
        const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                error: "Password must be at least 6 characters with letters and numbers",
            });
        }
        // Check if user exists in MongoDB
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
        // HASH THE PASSWORD - ADD THIS SECTION
        const saltRounds = 12;
        const hashedPassword = await bcrypt_1.default.hash(password, saltRounds);
        // Create user in MongoDB with dateOfBirth
        const newUser = new User({
            id: "user_" + Date.now(),
            username: username.trim(),
            email: email.trim().toLowerCase(),
            dateOfBirth: new Date(dateOfBirth), // ADD THIS
            password: hashedPassword,
            image: image ||
                `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=random&color=000000&bold=true`,
            isOnline: true,
            lastSeen: new Date(),
        });
        await newUser.save();
        console.log(`✅ New user registered: ${username} (${email})`);
        // Send welcome email (NEW CODE)
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
            }
            catch (emailError) {
                console.log("⚠️ Failed to send welcome email:", emailError instanceof Error ? emailError.message : String(emailError));
                // Don't fail the registration if email fails
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
    }
    catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Add after your existing endpoints, before Socket.IO connection
// Forgot password endpoint
// Forgot password endpoint - FIXED FOR MONGODB
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
        // Check if user exists in MongoDB
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            // Don't reveal if email exists or not for security
            console.log(`❓ Password reset requested for non-existent email: ${email}`);
            return res.json({
                message: "If the email exists, password reset instructions have been sent",
            });
        }
        // Generate reset token (simple version for demo)
        const resetToken = Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
        // Store reset token with expiration (1 hour)
        user.resetToken = resetToken;
        user.resetTokenExpiry = new Date(Date.now() + 3600000);
        await user.save();
        console.log(`🔐 Password reset token generated for: ${email}`);
        // Send response immediately
        res.json({
            message: "If the email exists, password reset instructions have been sent",
        });
        // Send reset email async
        setTimeout(async () => {
            try {
                const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
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
            }
            catch (emailError) {
                console.error("❌ Failed to send reset email:", emailError);
            }
        }, 0);
    }
    catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Reset password endpoint
// Reset password endpoint - FIXED FOR MONGODB
app.post("/api/auth/reset-password", async (req, res) => {
    try {
        const { token, email, newPassword } = req.body;
        if (!token || !email || !newPassword) {
            return res.status(400).json({ error: "All fields are required" });
        }
        // Validate password strength
        const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/;
        if (!passwordRegex.test(newPassword)) {
            return res.status(400).json({
                error: "Password must be at least 6 characters with letters and numbers",
            });
        }
        // Find user in MongoDB
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(400).json({ error: "Invalid reset token" });
        }
        // Check if token matches and hasn't expired
        if (!user.resetToken || user.resetToken !== token) {
            return res.status(400).json({ error: "Invalid reset token" });
        }
        if (!user.resetTokenExpiry ||
            Date.now() > user.resetTokenExpiry.getTime()) {
            return res.status(400).json({ error: "Reset token has expired" });
        }
        // HASH THE NEW PASSWORD - ADD THIS SECTION
        const saltRounds = 12;
        const hashedPassword = await bcrypt_1.default.hash(newPassword, saltRounds);
        // Update password and clear reset token
        user.password = hashedPassword; // CHANGED: Store hashed password
        user.resetToken = undefined;
        user.resetTokenExpiry = undefined;
        await user.save();
        console.log(`✅ Password reset successful for: ${email}`);
        setTimeout(async () => {
            // Send confirmation email
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
                await sendEmail(email, "Your Blabber Password Has Been Reset ✅", mailOptions.html);
                console.log(`✅ Password reset confirmation sent to: ${email}`);
            }
            catch (emailError) {
                console.log("⚠️ Failed to send confirmation email:", emailError);
                // Don't fail the reset if email fails
            }
        }, 0);
        res.json({ message: "Password reset successfully" });
    }
    catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// User login endpoint
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
        const isPasswordValid = await bcrypt_1.default.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: "Invalid email or password" });
        }
        // Update user as online
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
    }
    catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Get channel by invite code
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
    }
    catch (error) {
        console.error("Get channel error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Join channel via invite code
// Join channel via invite code - FIXED FOR MONGODB
app.post("/api/channel/join/:inviteCode", async (req, res) => {
    try {
        const { inviteCode } = req.params;
        const { userId } = req.body;
        console.log(`👤 User ${userId} attempting to join via ${inviteCode}`);
        const channel = await Channel.findOne({ inviteCode });
        if (!channel) {
            return res.status(404).json({ error: "Invalid invite link" });
        }
        // Add user to channel members if not already a member
        if (!channel.members.includes(userId)) {
            channel.members.push(userId);
            await channel.save();
            console.log(`✅ User ${userId} joined channel ${channel.name}`);
        }
        else {
            console.log(`ℹ️ User ${userId} already a member of ${channel.name}`);
        }
        res.json({ channel });
    }
    catch (error) {
        console.error("Join channel error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Get all users endpoint (optional)
app.get("/api/users", async (req, res) => {
    try {
        const users = await User.find({}, { password: 0 }); // Exclude passwords
        res.json(users);
    }
    catch (error) {
        console.error("Get users error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// ADD THESE MISSING ENDPOINTS BEFORE SOCKET.IO CONNECTION
// Create channel endpoint
// Create channel endpoint - WITH DUPLICATE NAME CHECK
app.post("/api/channel/create", async (req, res) => {
    try {
        const { name, description, image, bgcolor, isPrivate, createdBy } = req.body;
        if (!name || !createdBy) {
            return res.status(400).json({ error: "Name and createdBy are required" });
        }
        const user = await User.findOne({ id: createdBy });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        // Check if channel name already exists (case insensitive)
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
    }
    catch (error) {
        console.error("Create channel error:", error);
        // Handle duplicate key errors specifically
        if (error.code === 11000 || error.name === "MongoError") {
            return res.status(400).json({
                error: `Channel "${name}" already exists. Please choose a different name.`,
            });
        }
        res.status(500).json({ error: "Internal server error" });
    }
});
// Create or get existing DM channel - WITH INVITE CODE FIX
app.post("/api/channels/direct-message", async (req, res) => {
    try {
        const { userId1, userId2 } = req.body;
        if (!userId1 || !userId2) {
            return res.status(400).json({ error: "Both user IDs are required" });
        }
        // Sort user IDs to ensure consistent channel lookup
        const sortedUserIds = [userId1, userId2].sort();
        const dmChannelName = `dm_${sortedUserIds[0]}_${sortedUserIds[1]}`;
        console.log(`🔍 Looking for DM channel: ${dmChannelName}`);
        // Check if DM channel already exists between these users
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
        // Get user data for both users
        const user1 = await User.findOne({ id: userId1 });
        const user2 = await User.findOne({ id: userId2 });
        if (!user1 || !user2) {
            return res.status(404).json({ error: "One or both users not found" });
        }
        // ✅ FIX: Generate unique invite code for DM channels
        const generateUniqueInviteCode = () => {
            return `dm_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        };
        const inviteCode = generateUniqueInviteCode();
        // Create DM channel
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
            inviteCode: inviteCode, // ✅ Use unique code instead of null
            inviteLink: `${FRONTEND_URL}/invite/${inviteCode}`, // Optional: include invite link
            createdAt: new Date(),
        });
        await dmChannel.save();
        console.log(`✅ Created new DM channel: ${dmChannel.id} with invite code: ${inviteCode}`);
        // Emit real-time event for new DM channel
        io.emit("dm:channel:created", {
            channel: dmChannel,
            participants: [userId1, userId2],
        });
        res.json({
            success: true,
            channel: dmChannel,
            isNew: true,
        });
    }
    catch (error) {
        console.error("❌ Create DM channel error:", error);
        // Handle duplicate key error
        if (error.code === 11000) {
            // If it's a duplicate, try to find the existing channel
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
            }
            catch (findError) {
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
// Get user's DM channels
app.get("/api/user/:userId/direct-messages", async (req, res) => {
    try {
        const { userId } = req.params;
        const dmChannels = await Channel.find({
            isDM: true,
            members: userId,
        }).sort({ updatedAt: -1 });
        // Enrich with participant data
        const enrichedChannels = await Promise.all(dmChannels.map(async (channel) => {
            // Get the other participant's info
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
        }));
        res.json({
            success: true,
            channels: enrichedChannels,
        });
    }
    catch (error) {
        console.error("Get DM channels error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Get all channels
app.get("/api/channels", async (req, res) => {
    try {
        const channels = await Channel.find({});
        res.json(channels);
    }
    catch (error) {
        console.error("Get channels error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Get user's channels
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
    }
    catch (error) {
        console.error("Get user channels error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Delete channel
// FIXED Delete channel endpoint
app.delete("/api/channel/:channelId", async (req, res) => {
    try {
        const { channelId } = req.params;
        const { userId, deletedBy } = req.body;
        console.log(`🗑️ Delete request for channel: ${channelId}`);
        console.log(`👤 User attempting delete: ${userId || deletedBy}`);
        // Use either userId or deletedBy
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
        console.log(`🔍 Channel found: ${channel.name}, Creator: ${channel.createdBy}`);
        console.log(`👤 Deleting user: ${deletingUser}`);
        if (channel.createdBy !== deletingUser) {
            console.log(`❌ Permission denied: ${deletingUser} is not the creator`);
            return res.status(403).json({ error: "Only creator can delete channel" });
        }
        console.log(`✅ Permission granted, proceeding with deletion...`);
        // Delete channel image from Cloudinary if exists
        if (channel.image && channel.image.includes("cloudinary.com")) {
            console.log(`🖼️ Deleting channel image from Cloudinary...`);
            await deleteCloudinaryImage(channel.image);
        }
        // Delete all messages in the channel
        console.log(`🗑️ Deleting messages for channel: ${channelId}`);
        await Message.deleteMany({ channelId: channelId });
        // Delete the channel
        console.log(`🗑️ Deleting channel: ${channelId}`);
        await Channel.deleteOne({ id: channelId });
        console.log(`✅ Channel successfully deleted: ${channel.name}`);
        // Broadcast channel deletion to all clients
        io.emit("channel:deleted", {
            channelId: channelId,
            deletedBy: deletingUser,
        });
        res.json({
            success: true,
            message: "Channel deleted successfully",
            channelId: channelId,
        });
    }
    catch (error) {
        console.error("❌ Delete channel error:", error);
        res.status(500).json({ error: "Internal server error: " + error.message });
    }
});
// Update channel
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
        if (image &&
            image !== channel.image &&
            channel.image &&
            channel.image.includes("cloudinary.com")) {
            await deleteCloudinaryImage(channel.image);
        }
        if (name)
            channel.name = name.trim();
        if (description !== undefined)
            channel.description = description;
        if (image)
            channel.image = image;
        if (bgcolor)
            channel.bgcolor = bgcolor;
        await channel.save();
        console.log(`✅ Channel updated: ${channel.name}`);
        io.emit("channel:updated", channel);
        res.json({ success: true, channel });
    }
    catch (error) {
        console.error("Update channel error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Get channel messages
app.get("/api/channel/:channelId/messages", async (req, res) => {
    try {
        const { channelId } = req.params;
        const { before, limit = "50" } = req.query;
        // Validate channelId
        if (!channelId) {
            return res.status(400).json({
                success: false,
                error: "Channel ID is required",
            });
        }
        // Validate limit
        const limitNum = parseInt(limit);
        if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
            return res.status(400).json({
                success: false,
                error: "Limit must be between 1 and 100",
            });
        }
        console.log(`📥 Fetching messages for channel ${channelId}, before: ${before}, limit: ${limitNum}`);
        // Build query
        let query = { channelId };
        // If "before" parameter is provided, get messages older than this message
        if (before && typeof before === "string") {
            // First, find the reference message to get its timestamp
            const referenceMessage = await Message.findOne({ id: before });
            if (referenceMessage) {
                query.timestamp = { $lt: referenceMessage.timestamp };
                console.log(`🔍 Fetching messages before: ${referenceMessage.timestamp}`);
            }
            else {
                console.log(`❌ Reference message not found: ${before}`);
                // If reference message not found, return empty array
                return res.json([]);
            }
        }
        // Fetch messages with pagination
        const messages = await Message.find(query)
            .sort({ timestamp: 1 }) // Get oldest first (for chronological order)
            .limit(limitNum)
            .exec();
        console.log(`✅ Found ${messages.length} messages for channel ${channelId}`);
        // Return messages in chronological order (oldest first)
        res.json(messages);
    }
    catch (error) {
        console.error("❌ Get messages error:", error);
        res.status(500).json({
            success: false,
            error: "Internal server error",
            details: error instanceof Error ? error.message : "Unknown error",
        });
    }
});
// Delete message
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
    }
    catch (error) {
        console.error("Delete message error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Mark message as seen
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
        // Check if user has already seen this message
        const alreadySeen = message.seenBy.some((seen) => seen.userId === userId);
        if (!alreadySeen) {
            message.seenBy.push({
                userId,
                timestamp: new Date(),
            });
            await message.save();
            // Broadcast the update to all clients in the channel
            io.emit("message:seen", {
                messageId,
                userId,
                timestamp: new Date(),
                channelId: message.channelId,
            });
        }
        res.json({ success: true, message: "Message marked as seen" });
    }
    catch (error) {
        console.error("Mark message seen error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Get unseen messages count for a user
app.get("/api/user/:userId/unseen-count", async (req, res) => {
    try {
        const { userId } = req.params;
        const { channelId } = req.query;
        let query = {
            "seenBy.userId": { $ne: userId },
            userId: { $ne: userId }, // Don't count user's own messages
        };
        if (channelId) {
            query.channelId = channelId;
        }
        const unseenCount = await Message.countDocuments(query);
        res.json({ success: true, unseenCount });
    }
    catch (error) {
        console.error("Get unseen count error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Get message seen status
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
    }
    catch (error) {
        console.error("Get seen status error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// In your server.ts - make sure it's a GET endpoint
app.get("/api/allusers", async (req, res) => {
    try {
        const users = await User.find({}, { password: 0 }); // Exclude passwords
        res.json(users);
    }
    catch (error) {
        console.error("Get all users error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Logout endpoint
// Enhanced logout endpoint - HANDLES GOOGLE ACCOUNTS
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
        // Update user as offline
        user.isOnline = false;
        user.lastSeen = new Date();
        await user.save();
        console.log(`✅ User logged out: ${user.username} (${userId})`);
        // Broadcast user logout to all connected clients
        io.emit("user:logged-out", {
            userId: userId,
            username: user.username,
            isOnline: false,
            lastSeen: new Date(),
        });
        // If logoutAllDevices is true, clear any session tokens (for future use)
        if (logoutAllDevices) {
            // You can add session token cleanup here if you implement sessions
            console.log(`🔐 Logged out from all devices: ${user.username}`);
        }
        res.json({
            success: true,
            message: "Logged out successfully",
            userId: userId,
        });
    }
    catch (error) {
        console.error("Logout error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
// Socket.IO connection handling
// Socket.IO connection handling - FIXED FOR MONGODB
io.on("connection", (socket) => {
    console.log(`✅ User connected: ${socket.id}`);
    // Handle authentication
    socket.on("authenticate", (userData) => {
        console.log(`🔐 User authenticated: ${userData.username}`);
        // Store user-socket mapping if needed
    });
    socket.on("disconnect", (reason) => {
        console.log(`❌ User disconnected: ${socket.id} - Reason: ${reason}`);
    });
    socket.on("error", (error) => {
        console.error(`💥 Socket error for ${socket.id}:`, error);
    });
    // In-memory storage for active socket connections only
    const activeSockets = new Map(); // socketId -> userData
    // Friend request notifications
    socket.on("friend:request:read", (data) => {
        // Mark friend request as read (optional)
        console.log(`Friend request read by user: ${data.userId}`);
    });
    // Friend online status
    // Friend online status
    socket.on("friend:online", async (userId) => {
        try {
            // Get user's friends
            const friendships = await Friends.find({ userId }).populate("friendId", "id username image isOnline");
            const onlineFriends = friendships
                .filter((f) => {
                // FIX: Check if friendId is populated and has isOnline property
                if (typeof f.friendId === "object" && f.friendId !== null) {
                    return f.friendId.isOnline; // Type assertion
                }
                return false;
            })
                .map((f) => {
                if (typeof f.friendId === "object" && f.friendId !== null) {
                    return f.friendId;
                }
                return null;
            })
                .filter(Boolean); // Remove null values
            // Send online friends list to the user
            socket.emit("friends:online", onlineFriends);
        }
        catch (error) {
            console.error("Get online friends error:", error);
        }
    });
    // User joins
    socket.on("user:join", async (userData, channelId = "1") => {
        try {
            console.log(`👤 User join event: ${userData.username} (${userData.id})`);
            // Find user in MongoDB and update online status
            const user = await User.findOne({ id: userData.id });
            if (!user) {
                console.log(`❌ User not found in database: ${userData.id}`);
                return;
            }
            // Update user as online
            user.isOnline = true;
            user.lastSeen = new Date();
            await user.save();
            // Store socket connection
            activeSockets.set(socket.id, {
                ...user.toObject(),
                socketId: socket.id,
                currentChannelId: channelId,
            });
            console.log(`✅ User ${user.username} added to active sockets`);
            // Get channels the user is a member of
            const userChannels = await Channel.find({
                $or: [{ members: user.id }, { createdBy: user.id }],
            });
            // Get online users from database
            const onlineUsers = await User.find({ isOnline: true }, { password: 0 });
            // Get channel messages
            const channelMessages = await Message.find({ channelId: channelId });
            // Send current state to the user
            socket.emit("channel:list", userChannels);
            socket.emit("message:history", channelMessages);
            io.emit("user:online", onlineUsers);
            // Broadcast to other clients
            socket.broadcast.emit("user:joined", {
                id: user.id,
                username: user.username,
                email: user.email,
                image: user.image,
                isOnline: true,
            }, channelId);
        }
        catch (error) {
            console.error("User join error:", error);
        }
    });
    socket.on("user:deleted", (data) => {
        console.log(`🗑️ User account deleted: ${data.userId}`);
        // Broadcast to all clients that this user was deleted
        io.emit("user:deleted", { userId: data.userId });
        // Force disconnect any sockets for this user
        const userSockets = Array.from(activeSockets.entries()).filter(([_, userData]) => userData.id === data.userId);
        for (const [socketId, _] of userSockets) {
            io.sockets.sockets.get(socketId)?.disconnect(true);
            activeSockets.delete(socketId);
        }
        console.log(`✅ Disconnected ${userSockets.length} sockets for deleted user`);
    });
    // User update
    socket.on("user:update", async (updatedUser) => {
        try {
            console.log(`🔄 User update received: ${updatedUser.username}`);
            // Update user in MongoDB
            await User.findOneAndUpdate({ id: updatedUser.id }, {
                username: updatedUser.username,
                email: updatedUser.email,
                image: updatedUser.image,
            });
            // Update in active sockets if online
            const activeUser = activeSockets.get(socket.id);
            if (activeUser) {
                Object.assign(activeUser, updatedUser);
            }
            // Broadcast the update to all clients
            io.emit("user:updated", updatedUser);
        }
        catch (error) {
            console.error("User update error:", error);
        }
    });
    socket.on("channel:deleted", (data) => {
        console.log(`🗑️ Channel deleted event received: ${data.channelId}`);
        // Update your channels list in real-time
        // This will remove the deleted channel from all users' lists
    });
    // Join channel
    // In your server code, find the "channel:join" event handler and REPLACE it with:
    socket.on("channel:join", async (channelId, userId) => {
        try {
            console.log(`👤 Channel join: ${userId} → ${channelId}`);
            const channel = await Channel.findOne({ id: channelId });
            const activeUser = activeSockets.get(socket.id);
            if (!channel || !activeUser) {
                console.log("❌ Channel or user not found");
                return;
            }
            // JOIN SOCKET.IO ROOM for this channel
            socket.join(`channel-${channelId}`);
            console.log(`✅ Socket joined room: channel-${channelId}`);
            // IMMEDIATELY send empty array first to clear previous messages
            socket.emit("message:history", []);
            // Then load and send actual messages
            const channelMessages = await Message.find({ channelId: channelId }).sort({ timestamp: 1 });
            console.log(`📤 Sending ${channelMessages.length} messages to ${activeUser.username}`);
            // Send messages in smaller batches for faster display
            if (channelMessages.length > 0) {
                // Send first batch immediately
                const firstBatch = channelMessages.slice(0, 20);
                socket.emit("message:history", firstBatch);
                // Send remaining messages in background
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
        }
        catch (error) {
            console.error("❌ Channel join error:", error);
        }
    });
    // Message send
    // Add this endpoint to get unread count per channel for a user
    // In server.ts - ADD THIS after your existing unread endpoint
    app.get("/api/user/:userId/unread-by-channel", async (req, res) => {
        try {
            const { userId } = req.params;
            const userChannels = await Channel.find({
                $or: [{ members: userId }, { createdBy: userId }],
            });
            const channelIds = userChannels.map((ch) => ch.id);
            const unreadCounts = await Promise.all(channelIds.map(async (channelId) => {
                const count = await Message.countDocuments({
                    channelId: channelId,
                    userId: { $ne: userId }, // Not user's own messages
                    "seenBy.userId": { $ne: userId }, // User hasn't seen them
                });
                return { channelId, count };
            }));
            const unreadByChannel = unreadCounts.reduce((acc, { channelId, count }) => {
                acc[channelId] = count;
                return acc;
            }, {});
            res.json({ success: true, unreadByChannel });
        }
        catch (error) {
            console.error("Get unread by channel error:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });
    // Update the existing message:seen socket handler to broadcast unread count updates
    // Replace your existing socket.on("message:seen") with this:
    socket.on("message:seen", async (data) => {
        try {
            const { messageId, userId } = data;
            const message = await Message.findOne({ id: messageId });
            if (!message)
                return;
            const alreadySeen = message.seenBy.some((seen) => seen.userId === userId);
            if (!alreadySeen) {
                message.seenBy.push({
                    userId,
                    timestamp: new Date(),
                });
                await message.save();
                // Broadcast to all clients in the channel
                io.emit("message:seen", {
                    messageId,
                    userId,
                    timestamp: new Date(),
                    channelId: message.channelId,
                });
                // Calculate and broadcast updated unread count for this user
                const unreadCount = await Message.countDocuments({
                    channelId: message.channelId,
                    userId: { $ne: userId },
                    "seenBy.userId": { $ne: userId },
                });
                // Emit to specific user's socket
                io.to(`user-${userId}`).emit("unread:update", {
                    channelId: message.channelId,
                    count: unreadCount,
                });
            }
        }
        catch (error) {
            console.error("Message seen error:", error);
        }
    });
    let messageBatch = [];
    let batchTimeout = null;
    const flushMessageBatch = () => {
        if (messageBatch.length > 0) {
            console.log(`📦 Flushing batch of ${messageBatch.length} messages`);
            // Group messages by channel for efficient broadcasting
            const messagesByChannel = messageBatch.reduce((acc, message) => {
                if (!acc[message.channelId]) {
                    acc[message.channelId] = [];
                }
                acc[message.channelId].push(message);
                return acc;
            }, {});
            // Broadcast batched messages to respective channels
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
    // Optimized message:send handler with batching
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
            if (!channel ||
                (!channel.members.includes(activeUser.id) &&
                    channel.createdBy !== activeUser.id)) {
                console.log("❌ Message rejected: User not a member of channel");
                socket.emit("error", { message: "Not a channel member" });
                return;
            }
            let message;
            if (messageData.id) {
                // Handle message edits (no batching for edits)
                message = await Message.findOne({ id: messageData.id });
                if (!message || message.userId !== activeUser.id) {
                    console.log("❌ Edit rejected: unauthorized");
                    socket.emit("error", { message: "Cannot edit this message" });
                    return;
                }
                message.content = messageData.content;
                await message.save();
                console.log(`✏️ Message edited: ${message.id}`);
                // Broadcast edit immediately
                io.emit("message:updated", {
                    id: message.id,
                    content: message.content,
                    userId: message.userId,
                    username: message.username,
                    channelId: message.channelId,
                    type: message.type,
                    timestamp: message.timestamp,
                });
            }
            else {
                // Handle new messages (with batching)
                message = new Message({
                    id: (0, uuid_1.v4)(),
                    content: messageData.content,
                    userId: activeUser.id,
                    username: activeUser.username,
                    channelId: messageData.channelId,
                    userImage: activeUser.image,
                    type: messageData.type || "text",
                    timestamp: new Date(),
                });
                await message.save();
                const messageType = messageData.type?.toUpperCase() || "TEXT";
                console.log(`💬 ${messageType} message from ${activeUser.username} in channel ${messageData.channelId}`);
                // Send immediately to sender (no delay for user experience)
                socket.emit("message:receive", message);
                console.log(`✅ Message sent back to sender: ${activeUser.username}`);
                // Add to batch for broadcasting to other users
                messageBatch.push(message);
                console.log(`📥 Added to batch. Batch size: ${messageBatch.length}`);
                // Optimized batching logic
                if (messageBatch.length >= 3) {
                    // Flush immediately if we have 3+ messages
                    if (batchTimeout) {
                        clearTimeout(batchTimeout);
                        batchTimeout = null;
                    }
                    flushMessageBatch();
                }
                else if (!batchTimeout) {
                    // Wait max 50ms for more messages before flushing
                    batchTimeout = setTimeout(flushMessageBatch, 50);
                }
                // Handle unread counts (outside of batching since it's lightweight)
                if (!messageData.id) {
                    const otherMembers = channel.members.filter((memberId) => memberId !== activeUser.id);
                    // Optimize unread count updates - batch these too if needed
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
        }
        catch (error) {
            console.error("❌ Message send error:", error);
            socket.emit("error", { message: "Failed to send message" });
            // Clear batch on error
            if (batchTimeout) {
                clearTimeout(batchTimeout);
                batchTimeout = null;
            }
            messageBatch = [];
        }
    });
    // Add a force flush function for when users disconnect or switch channels
    const forceFlushMessageBatch = () => {
        if (batchTimeout) {
            clearTimeout(batchTimeout);
            batchTimeout = null;
        }
        flushMessageBatch();
    };
    // Force flush on certain events
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
            // Update the message (only content for GIF messages)
            message.content = messageData.content;
            await message.save();
            console.log(`✅ Message updated: ${message.id}`);
            // BROADCAST to everyone in the channel
            io.emit("message:updated", {
                id: message.id,
                content: message.content,
                userId: message.userId,
                username: message.username,
                channelId: message.channelId,
                type: message.type, // This now includes "gif" type
                timestamp: message.timestamp,
            });
            console.log(`📡 Update broadcast sent to all clients for message ${message.id}`);
        }
        catch (error) {
            console.error("❌ Edit message error:", error);
            socket.emit("error", { message: "Failed to edit message" });
        }
    });
    // Typing indicator
    socket.on("user:typing", (typingData) => {
        console.log(`⌨️  ${typingData.username} is typing...`);
        // Broadcast to other clients
        socket.broadcast.emit("user:typing", {
            ...typingData,
            isTyping: true,
        });
        // Auto-stop after 3 seconds
        setTimeout(() => {
            socket.broadcast.emit("user:typing", {
                ...typingData,
                isTyping: false,
            });
        }, 3000);
    });
    // Switch channel
    socket.on("user:switchChannel", async (userId, newChannelId) => {
        try {
            const activeUser = activeSockets.get(socket.id);
            if (activeUser) {
                activeUser.currentChannelId = newChannelId;
                // Update online users list
                const onlineUsers = await User.find({ isOnline: true }, { password: 0 });
                io.emit("user:online", onlineUsers);
            }
        }
        catch (error) {
            console.error("Switch channel error:", error);
        }
    });
    // User identification
    socket.on("user:identify", (userId) => {
        socket.join(`user-${userId}`);
        console.log(`✅ User ${userId} joined room user-${userId}`);
    });
    // In Socket.IO connection handling - UPDATE THESE EVENT HANDLERS:
    socket.on("webrtc:call-offer", (data) => {
        console.log("📞 Call offer received:", {
            from: data.from,
            to: data.to,
            audioOnly: data.audioOnly,
            fromImage: data.fromImage,
            isDMChannel: data.isDMChannel, // Add this log
            isChannelCall: data.isChannelCall, // Also log this
        });
        // Make sure we're emitting ALL the data including isDMChannel
        io.to(`user-${data.to}`).emit("webrtc:call-offer", {
            ...data, // Spread all properties
            // Ensure these fields are included
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
            isDMChannel: data.isDMChannel, // Add this log
        });
        io.to(`user-${data.to}`).emit("webrtc:call-answer", {
            ...data, // Spread all properties
            isDMChannel: data.isDMChannel || false, // Ensure it's included
        });
    });
    socket.on("webrtc:ice-candidate", (data) => {
        console.log(`🧊 ICE candidate from ${data.from} to ${data.to}`, {
            isChannelCall: data.isChannelCall,
            isDMChannel: data.isDMChannel, // Add this log
        });
        io.to(`user-${data.to}`).emit("webrtc:ice-candidate", {
            candidate: data.candidate,
            from: data.from,
            fromUsername: data.fromUsername,
            fromImage: data.fromImage,
            isChannelCall: data.isChannelCall,
            channelId: data.channelId,
            // ADD THIS:
            isDMChannel: data.isDMChannel || false,
        });
    });
    socket.on("webrtc:call-end", (data) => {
        socket.broadcast.emit("webrtc:call-end", { from: data.from });
    });
    socket.on("webrtc:call-reject", (data) => {
        io.to(`user-${data.to}`).emit("webrtc:call-reject", { from: data.from });
    });
    // Disconnect
    // Enhanced disconnect handler
    socket.on("disconnect", async (reason) => {
        try {
            const activeUser = activeSockets.get(socket.id);
            if (activeUser) {
                console.log(`❌ User disconnected: ${activeUser.username} (${socket.id}) - Reason: ${reason}`);
                // Only update as offline if this is their only active connection
                const userActiveConnections = Array.from(activeSockets.entries()).filter(([_, userData]) => userData.id === activeUser.id);
                if (userActiveConnections.length <= 1) {
                    // This was their last connection, mark as offline
                    await User.findOneAndUpdate({ id: activeUser.id }, {
                        isOnline: false,
                        lastSeen: new Date(),
                    });
                    // Broadcast user left only if this was their last connection
                    socket.broadcast.emit("user:left", {
                        id: activeUser.id,
                        username: activeUser.username,
                        email: activeUser.email,
                        image: activeUser.image,
                        isOnline: false,
                        lastSeen: new Date(),
                    }, activeUser.currentChannelId || "1");
                    console.log(`📢 Broadcasted user offline: ${activeUser.username}`);
                }
                // Remove from active sockets
                activeSockets.delete(socket.id);
                // Update online users list
                const onlineUsers = await User.find({ isOnline: true }, { password: 0 });
                io.emit("user:online", onlineUsers);
            }
            else {
                console.log(`❌ Socket disconnected: ${socket.id} (no user found) - Reason: ${reason}`);
            }
        }
        catch (error) {
            console.error("Disconnect error:", error);
        }
    });
});
app.get("/api/link-preview", async (req, res) => {
    let abortController = null;
    try {
        const { url } = req.query;
        // Validate URL parameter
        if (!url || typeof url !== "string") {
            return res
                .status(400)
                .json({ error: "URL parameter is required and must be a string" });
        }
        // Validate URL format
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        }
        catch (error) {
            return res.status(400).json({ error: "Invalid URL format" });
        }
        // Optional: Validate allowed domains for security
        const allowedProtocols = ["http:", "https:"];
        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            return res.status(400).json({ error: "Invalid URL protocol" });
        }
        // Optional: Block certain domains for security
        const blockedDomains = ["localhost", "127.0.0.1", "0.0.0.0", "internal"];
        if (blockedDomains.some((domain) => parsedUrl.hostname.includes(domain))) {
            return res.status(400).json({ error: "Domain not allowed" });
        }
        // Create abort controller for timeout
        abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            abortController?.abort();
        }, 10000); // 10 second timeout
        const response = await fetch(parsedUrl.toString(), {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; LinkPreviewBot/1.0)",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
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
        // Enhanced meta tag parsing with regex improvements
        const getMetaContent = (property) => {
            const regex = new RegExp(`<meta[^>]*(property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`, "i");
            const match = html.match(regex);
            return match ? match[2] : null;
        };
        const getTitle = () => {
            // Try OpenGraph title first, then regular title
            const ogTitle = getMetaContent("og:title");
            if (ogTitle)
                return ogTitle;
            const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
            return titleMatch ? titleMatch[1].trim() : null;
        };
        const getDescription = () => {
            // Try OpenGraph description, then Twitter, then regular meta description
            const ogDesc = getMetaContent("og:description");
            if (ogDesc)
                return ogDesc;
            const twitterDesc = getMetaContent("twitter:description");
            if (twitterDesc)
                return twitterDesc;
            return getMetaContent("description");
        };
        const getImage = () => {
            // Try OpenGraph image, then Twitter image
            const ogImage = getMetaContent("og:image");
            if (ogImage) {
                try {
                    return new URL(ogImage, parsedUrl.origin).toString();
                }
                catch {
                    return ogImage;
                }
            }
            const twitterImage = getMetaContent("twitter:image");
            if (twitterImage) {
                try {
                    return new URL(twitterImage, parsedUrl.origin).toString();
                }
                catch {
                    return twitterImage;
                }
            }
            return null;
        };
        const getSiteName = () => {
            const ogSiteName = getMetaContent("og:site_name");
            if (ogSiteName)
                return ogSiteName;
            const twitterSite = getMetaContent("twitter:site");
            if (twitterSite)
                return twitterSite.replace("@", "");
            return parsedUrl.hostname.replace("www.", "");
        };
        const title = getTitle();
        const description = getDescription();
        const image = getImage();
        const siteName = getSiteName();
        res.json({
            title: title ? title.trim().substring(0, 200) : null, // Limit title length
            description: description ? description.trim().substring(0, 300) : null, // Limit description length
            image,
            siteName: siteName ? siteName.trim() : null,
            url: parsedUrl.toString(),
        });
    }
    catch (error) {
        console.error("Link preview error:", error);
        // Clear timeout if it hasn't fired yet
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
