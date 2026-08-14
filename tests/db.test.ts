import dotenv from 'dotenv';
import mongoose from 'mongoose';
import dns from 'dns'

dns.setServers(['8.8.8.8']);

dotenv.config({ quiet: true });

describe('MongoDB connection', () => {
  const mongoUri = process.env.MONGODB_URI;

  beforeAll(async () => {
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not set. Add it to your .env file before running this test.');
    }

    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  }, 15_000);

  afterAll(async () => {
    await mongoose.disconnect();
  }, 15_000);

  it('connects successfully', () => {
    expect(mongoose.connection.readyState).toBe(1);
  });

  it('responds to a ping', async () => {
    const result = await mongoose.connection.db!.admin().ping();
    expect(result.ok).toBe(1);
  });
});
