# Blabber Chat Backend

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge)](https://blabber-chat.netlify.app/)

The robust server-side engine for **Blabber Chat**, a real-time messaging platform inspired by Discord. This backend handles persistent socket connections, secure user authentication, and real-time message routing.

## 🚀 Key Features

* **Real-Time Communication:** Bi-directional messaging using Socket.IO for instant, low-latency delivery.
* **Authentication:** Secure JWT-based authentication for user registration and session management.
* **Event-Driven Architecture:** Manages complex real-time events such as typing indicators, online status, and message synchronization.
* **RESTful API:** Scalable endpoints for user profile management, channel creation, and conversation history.
* **Data Persistence:** Optimized queries and schema design for chat metadata and message history.

## 🛠️ Built With

<p align="left">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white" alt="Socket.io" />
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white" alt="JWT" />
</p>

## 📋 API Documentation (Sample)

| Route | Method | Description |
| :--- | :--- | :--- |
| `/api/auth/signup` | POST | Register a new user |
| `/api/auth/login` | POST | Authenticate and receive JWT |
| `/api/chats` | GET | Retrieve user conversations |
| `/api/messages/:chatId` | GET | Fetch message history for a channel |

## 🚀 Getting Started

1. **Clone the repository:**
```bash
   git clone [https://github.com/filipposobrijanu/blabber-app-backend.git](https://github.com/filipposobrijanu/blabber-app-backend.git)
