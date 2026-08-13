import mongoose from 'mongoose';

describe('MongoDB Cloud Connection', () => {
  const MONGODB_URI = process.env.MONGODB_URI as string;

  beforeAll(async () => {
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI is not set in environment variables');
    }
    await mongoose.connect(MONGODB_URI);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('should connect to the cloud MongoDB instance', () => {
    expect(mongoose.connection.readyState).toBe(1); // 1 = connected
  });

  it('should be able to ping the database', async () => {
    const admin = mongoose.connection.db!.admin();
    const result = await admin.ping();
    expect(result.ok).toBe(1);
  });

  it('should list at least one collection (sanity check)', async () => {
    const collections = await mongoose.connection.db!.listCollections().toArray();
    expect(Array.isArray(collections)).toBe(true);
  });
});
