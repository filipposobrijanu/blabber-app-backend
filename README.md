<h1 align="center">Blabber Chat Backend</h1>
<h3 align="center">WebSocket Engine & Real-Time Messaging Infrastructure</h3>

<p align="center">
  The server-side engine powering <strong>Blabber Chat</strong>, a real-time messaging platform inspired by Discord. This backend sychronizes persistent full-duplex socket connections, secure stateless user authentication pipelines, and real-time message routing layers.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License" />
  </a>
  <a href="https://blabber-chat.netlify.app/">
    <img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge" alt="Status" />
  </a>
</p>

---

### Production Tech Stack

**Runtime & Real-Time Layer**
<p align="left">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express.js" />
  <img src="https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white" alt="Socket.io" />
</p>

**Persistence & Object-Data Modeling**
<p align="left">
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Mongoose-880000?style=for-the-badge&logo=mongoose&logoColor=white" alt="Mongoose" />
</p>

**Identity & Access Management (IAM)**
<p align="left">
  <img src="https://img.shields.io/badge/JSON_Web_Tokens-000000?style=for-the-badge&logo=jsonwebtext&logoColor=white" alt="JWT" />
  <img src="https://img.shields.io/badge/Google_OAuth_2.0-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Google OAuth" />
  <img src="https://img.shields.io/badge/Bcrypt-000000?style=for-the-badge&logo=springsecurity&logoColor=white" alt="Bcrypt" />
</p>

**Cloud Architecture & Microservices**
<p align="left">
  <img src="https://img.shields.io/badge/Cloudinary_API-3448C5?style=for-the-badge&logo=cloudinary&logoColor=white" alt="Cloudinary" />
  <img src="https://img.shields.io/badge/Resend_Email_API-000000?style=for-the-badge&logo=resend&logoColor=white" alt="Resend" />
  <img src="https://img.shields.io/badge/Nodemailer-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Nodemailer" />
</p>

---

### Setup & Local Development

**1. Clone the repository:**
```bash
git clone https://github.com/filipposobrijanu/blabber-app-backend.git
cd blabber-app-backend
```

**2. Configure Local Environment Variables:**
Create a `.env` file within the root directory to declare server runtimes and third-party database target strings:
```env
EMAIL_USER="..."
EMAIL_PASS="..."
PORT=5000
CLOUDINARY_CLOUD_NAME="..."
CLOUDINARY_API_KEY="..."
CLOUDINARY_API_SECRET="..."
NODE_ENV=production
FRONTEND_URL=https://blabber-chat.netlify.app
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
MONGODB_URI="..."
RESEND_API_KEY="..."
```

**3. Dependency Provisioning:**
```bash
npm install
```

**4. Execute Runtime Engine:**
```bash
# Run using nodemon for dynamic file-watching hot reloads
npm run dev

# Boot standard node application process
npm start
```
