import mongoose from 'mongoose';
import { AppError, buildErrorBody } from '../src/utils/errorHandler';

describe('buildErrorBody', () => {
  it('turns an invalid ObjectId cast into a 400 that names the field and value', () => {
    const castError = new mongoose.Error.CastError('ObjectId', 'abc', '_id');
    const { statusCode, body } = buildErrorBody(castError, 'Failed to fetch deal');
    expect(statusCode).toBe(400);
    expect(body).toMatchObject({ status: false, code: 'INVALID_ID' });
    expect(body.message).toContain('"abc"');
  });

  it('lists each schema validation failure', () => {
    const schema = new mongoose.Schema({ name: { type: String, required: true }, kind: { type: String, enum: ['a', 'b'] } });
    const Model = mongoose.models.ErrTest || mongoose.model('ErrTest', schema);
    const error = new Model({ kind: 'z' }).validateSync();
    const { statusCode, body } = buildErrorBody(error, 'Failed');
    expect(statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toEqual(expect.arrayContaining(['name is required', 'kind must be one of: a, b']));
  });

  it('turns duplicate key errors into a 409 naming the field', () => {
    const dup = Object.assign(new Error('E11000'), { name: 'MongoServerError', code: 11000, keyValue: { email: 'a@b.com' } });
    const { statusCode, body } = buildErrorBody(dup, 'Failed');
    expect(statusCode).toBe(409);
    expect(body.message).toBe('A record with email "a@b.com" already exists');
  });

  it('passes AppError status and message through', () => {
    const { statusCode, body } = buildErrorBody(new AppError(404, 'Deal not found'), 'Failed');
    expect(statusCode).toBe(404);
    expect(body).toEqual({ status: false, message: 'Deal not found', code: 'NOT_FOUND' });
  });

  it('falls back to a 500 that names the failed operation', () => {
    const { statusCode, body } = buildErrorBody(new Error('boom'), 'Failed to update deal');
    expect(statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(String(body.message)).toMatch(/^Failed to update deal\. An unexpected server error occurred/);
  });

  it('does not forward upstream API errors that carry a 4xx status', () => {
    const upstream = Object.assign(new Error('Google says no'), { status: 401 });
    expect(buildErrorBody(upstream, 'Failed to sync').statusCode).toBe(500);
  });
});
