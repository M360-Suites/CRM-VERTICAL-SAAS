/**
 * CRM Backend API Server
 * Express server for Customer Relationship Management system
 */
import config from './src/config';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './src/config/swagger';
import connectDB from './src/config/db';
import authRoutes from './src/routes/authRoutes';
import userRoutes from './src/routes/userRoutes';
import contactRoutes from './src/routes/contactRoutes';
import dealRoutes from './src/routes/dealRoutes';
import companyRoutes from './src/routes/companyRoutes';
import taskRoutes from './src/routes/taskRoutes';
import pipelineRoutes from './src/routes/pipelineRoutes';
import analyticsRoutes from './src/routes/analyticsRoutes';
import reportsRoutes from './src/routes/reportsRoutes';
import emailWriterRoutes from './src/routes/emailWriterRoutes';
import documentRoutes from './src/routes/documentRoutes';
import folderRoutes from './src/routes/folderRoutes';
import emailSyncRoutes from './src/routes/emailSyncRoutes';
import dashboardRoutes from './src/routes/dashboardRoutes';
import { seedPipeline } from './src/seeds/pipelineSeed';
import { startTaskReminderService } from './src/services/taskReminderService';
import { rateLimit, securityHeaders } from './src/middleware/security';

const app = express();
const PORT = config.PORT;

type RequestParseError = Error & {
  status?: number;
  type?: string;
  body?: unknown;
};

app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(rateLimit);

/** Parse JSON and URL-encoded bodies */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(cors({
  origin: config.ORIGIN ? config.ORIGIN.split(',').map((origin) => origin.trim()) : false,
  credentials: true
}));

if (config.SWAGGER_ENABLED) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

/** Health check endpoint */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/** API routes */
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/contacts', contactRoutes);
app.use('/api/v1/deals', dealRoutes);
app.use('/api/v1/companies', companyRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/pipeline', pipelineRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/ai', emailWriterRoutes);
app.use('/api/v1/folders', folderRoutes);
app.use('/api/v1/documents', documentRoutes);
app.use('/api/v1/email', emailSyncRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

/** Global error handler */
app.use((err: RequestParseError, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && err.status === 400 && err.type === 'entity.parse.failed') {
    return res.status(400).json({
      status: false,
      message: 'Invalid JSON in request body'
    });
  }

  console.error(err.stack);
  res.status(500).json({
    status: false,
    message: 'Something went wrong'
  });
});

/**
 * Start the server
 * Connects to MongoDB and listens on configured port
 */
const startServer = async () => {
  try {
    await connectDB();
    await seedPipeline();
    startTaskReminderService();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
