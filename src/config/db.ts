/**
 * MongoDB database connection module
 * Handles connecting to MongoDB using Mongoose ODM
 */
import mongoose from 'mongoose';
import config from './index';
import dns from 'dns'

dns.setServers(['8.8.8.8']);
/**
 * Establishes connection to MongoDB database
 * @throws Exits process with code 1 if connection fails
 */
const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB;