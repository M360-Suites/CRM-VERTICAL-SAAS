/**
 * MongoDB database connection module
 * Handles connecting to MongoDB using Mongoose ODM
 */
import mongoose from 'mongoose';
import config from './index';
import { logger } from './logger';
import dns from 'dns'

dns.setServers(['8.8.8.8']);
/**
 * Establishes connection to MongoDB database
 * @throws Exits process with code 1 if connection fails
 */
const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(config.MONGODB_URI);
    logger.info('MongoDB connected successfully');
  } catch (error) {
    logger.error({ err: error }, 'MongoDB connection error');
    process.exit(1);
  }
};

export default connectDB;