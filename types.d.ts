declare module "express";
declare module "uuid";
declare module "nodemailer";
declare module "cloudinary";
declare namespace Express {
  export interface Request {
    user?: any;
  }
}
