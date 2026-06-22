import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import config from './index';

const swaggerBaseUrl = `http://localhost:${config.PORT}`;
const normalizeGlobPath = (globPath: string): string => globPath.replace(/\\/g, '/');
const routeDocsGlobs = [
  path.join(process.cwd(), 'src', 'routes', '*.ts'),
  path.join(process.cwd(), 'src', 'routes', '*.js'),
  path.join(__dirname, '..', 'routes', '*.js')
].map(normalizeGlobPath);

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CRM360 API',
      version: '1.0.0',
      description: 'Tenant-scoped Customer Relationship Management API. Authenticated resources are scoped to the current user organization.',
    },
    servers: [
      {
        url: 'https://crm-vertical-saas.onrender.com/api/v1',
        description: 'Production API v1',
      },
      {
        url: `${swaggerBaseUrl}/api/v1`,
        description: 'Configured API v1',
      },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'crm_AT',
          description: 'HttpOnly JWT access token cookie set by auth endpoints',
        },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token via Authorization header (fallback)',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: false },
            message: { type: 'string' },
            errors: {
              type: 'array',
              items: { type: 'string' },
              description: 'Validation errors when applicable',
            },
          },
        },
        Organization: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            slug: { type: 'string' },
            owner_id: { type: 'string', nullable: true },
            is_active: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        UserInvitation: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            email: { type: 'string' },
            display_name: { type: 'string', nullable: true },
            role: { type: 'string', enum: ['admin', 'sales_manager', 'sales_rep', 'viewer'] },
            organization_id: { type: 'string' },
            invited_by: { type: 'string' },
            expires_at: { type: 'string', format: 'date-time' },
            accepted_at: { type: 'string', format: 'date-time', nullable: true },
            revoked_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            display_name: { type: 'string' },
            avatar_url: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'sales_manager', 'sales_rep', 'viewer'] },
            organization_id: { type: 'string', description: 'Current tenant organization ID' },
            is_active: { type: 'boolean' },
            is_verified: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                user: { $ref: '#/components/schemas/User' },
              },
            },
          },
        },
        ForgotPasswordResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string', example: 'OTP sent to your email' },
            data: { type: 'object', example: {} },
          },
        },
        VerifyOTPResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string', example: 'OTP verified successfully' },
            data: {
              type: 'object',
              properties: {
                resetToken: { type: 'string', example: '64-character-reset-token' },
              },
            },
          },
        },
        ResetPasswordResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Password reset successfully' },
            data: { type: 'object', example: {} },
          },
        },
        CRMFile: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            original_name: { type: 'string' },
            stored_name: { type: 'string' },
            mime_type: { type: 'string' },
            file_size: { type: 'number' },
            cloudinary_url: { type: 'string' },
            cloudinary_public_id: { type: 'string' },
            organization_id: { type: 'string' },
            folder_id: { type: 'string', nullable: true },
            contact_id: { type: 'string', nullable: true },
            deal_id: { type: 'string', nullable: true },
            company_id: { type: 'string', nullable: true },
            owner_id: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        Folder: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            parent_id: { type: 'string', nullable: true },
            owner_id: { type: 'string' },
            last_modified_by: {
              type: 'object',
              nullable: true,
              properties: {
                _id: { type: 'string' },
                email: { type: 'string' },
                display_name: { type: 'string' },
              },
            },
            organization_id: { type: 'string' },
            document_count: { type: 'number' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        EmailResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean' },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                subject: { type: 'string' },
                body: { type: 'string' },
              },
            },
          },
        },
        EmailMessage: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            user_id: { type: 'string' },
            organization_id: { type: 'string' },
            gmail_message_id: { type: 'string' },
            thread_id: { type: 'string' },
            from_name: { type: 'string' },
            from_email: { type: 'string' },
            to: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            snippet: { type: 'string' },
            received_at: { type: 'string', format: 'date-time' },
            is_read: { type: 'boolean' },
            contact_id: { type: 'string', nullable: true },
          },
        },
        EmailMessagePaginatedResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/EmailMessage' },
                },
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total_pages: { type: 'integer' },
                stats: {
                  type: 'object',
                  properties: {
                    synced_count: { type: 'integer' },
                    link_ratio: { type: 'integer' },
                    linked_senders: { type: 'integer' },
                    total_senders: { type: 'integer' },
                    linked_messages: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
        Contact: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            email: { type: 'string' },
            phone: { type: 'string' },
            role_title: { type: 'string' },
            company_id: { type: 'string', nullable: true },
            owner_id: { type: 'string' },
            organization_id: { type: 'string' },
            temperature: { type: 'string', enum: ['hot', 'warm', 'cold'] },
            tags: { type: 'array', items: { type: 'string' } },
            last_contacted_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        ContactPaginatedResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Contact' },
                },
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total_pages: { type: 'integer' },
              },
            },
          },
        },
        ContactListResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string', example: 'All contacts retrieved successfully' },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/Contact' },
            },
          },
        },
        Deal: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            title: { type: 'string' },
            value: { type: 'number', nullable: true },
            currency: { type: 'string', example: 'USD' },
            status: { type: 'string', enum: ['open', 'won', 'lost'] },
            expected_close_date: { type: 'string', format: 'date-time', nullable: true },
            stage_id: { type: 'string', nullable: true },
            source: { type: 'string', nullable: true },
            industry: { type: 'string', nullable: true },
            company_id: { type: 'string', nullable: true },
            contact_id: { type: 'string', nullable: true },
            owner_id: { type: 'string', nullable: true },
            organization_id: { type: 'string' },
            stage_changed_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        DealListResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string', example: 'All deals retrieved successfully' },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/Deal' },
            },
          },
        },
        Company: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            industry: { type: 'string', nullable: true },
            website: { type: 'string', nullable: true },
            notes: { type: 'string', nullable: true },
            owner_id: { type: 'string', nullable: true },
            organization_id: { type: 'string' },
            contact_person: { type: 'string', nullable: true },
            email: { type: 'string', nullable: true },
            phone: { type: 'string', nullable: true },
            address: { type: 'string', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        CompanyPaginatedResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Company' },
                },
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total_pages: { type: 'integer' },
              },
            },
          },
        },
        PipelineDeal: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            value: { type: 'number', nullable: true },
            stage_id: { type: 'string', nullable: true },
            source: { type: 'string', nullable: true },
            industry: { type: 'string', nullable: true },
            company: {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
            stage_changed_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        PipelineStage: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            position: { type: 'number' },
            is_won: { type: 'boolean' },
            is_lost: { type: 'boolean' },
          },
        },
        PipelineTeamMember: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            display_name: { type: 'string' },
            email: { type: 'string' },
          },
        },
        StageAssignee: {
          type: 'object',
          properties: {
            stage_id: { type: 'string' },
            user_id: { type: 'string' },
          },
        },
        PipelinePageStage: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            total_deals: { type: 'number' },
            total_value: { type: 'number' },
            position: { type: 'number' },
            is_won: { type: 'boolean' },
            is_lost: { type: 'boolean' },
            assignedTo: {
              allOf: [{ $ref: '#/components/schemas/PipelineTeamMember' }],
              nullable: true,
            },
            deals: {
              type: 'array',
              items: { $ref: '#/components/schemas/PipelineDeal' },
            },
          },
        },
        PipelinePage: {
          type: 'object',
          properties: {
            stages: {
              type: 'array',
              items: { $ref: '#/components/schemas/PipelinePageStage' },
            },
            team_members: {
              type: 'array',
              items: { $ref: '#/components/schemas/PipelineTeamMember' },
            },
          },
        },
        PipelinePageResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Pipeline retrieved successfully' },
            data: {
              $ref: '#/components/schemas/PipelinePage',
            },
          },
        },
        Task: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            title: { type: 'string' },
            type: { type: 'string', enum: ['task', 'meeting', 'call', 'follow_up'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
            description: { type: 'string', nullable: true },
            due_at: { type: 'string', format: 'date-time', nullable: true },
            duration_minutes: { type: 'number', nullable: true },
            location: { type: 'string', nullable: true },
            meeting_url: { type: 'string', nullable: true },
            contact_id: { type: 'string', nullable: true },
            deal_id: { type: 'string', nullable: true },
            company_id: { type: 'string', nullable: true },
            owner_id: { type: 'string' },
            organization_id: { type: 'string' },
            assignees: { type: 'array', items: { type: 'string' } },
            reminder_sent_at: { type: 'string', format: 'date-time', nullable: true },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' },
          },
        },
        TaskResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: { $ref: '#/components/schemas/Task' },
          },
        },
        TaskListResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/Task' },
            },
          },
        },
        TaskPaginatedResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Tasks retrieved successfully' },
            data: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Task' },
                },
                total: { type: 'integer', example: 42 },
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 20 },
                total_pages: { type: 'integer', example: 3 },
              },
            },
          },
        },
        UserPaginatedResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: {
              type: 'object',
              properties: {
                data: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/User' },
                },
                total: { type: 'integer' },
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total_pages: { type: 'integer' },
              },
            },
          },
        },
        DashboardSummaryResponse: {
          type: 'object',
          properties: {
            status: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Dashboard summary retrieved successfully' },
            data: {
              type: 'object',
              properties: {
                cards: {
                  type: 'object',
                  properties: {
                    open_deals: { type: 'integer', example: 1 },
                    revenue_forecast: { type: 'number', example: 7623426 },
                    active_contacts: { type: 'integer', example: 12 },
                    active_companies: { type: 'integer', example: 12 },
                  },
                },
                card_progress: {
                  type: 'object',
                  properties: {
                    open_deals: {
                      type: 'object',
                      properties: {
                        current: { type: 'number', example: 1 },
                        previous: { type: 'number', example: 0 },
                        change: { type: 'number', example: 1 },
                        percent_change: { type: 'number', example: 100 },
                      },
                    },
                    revenue_forecast: {
                      type: 'object',
                      properties: {
                        current: { type: 'number', example: 7623426 },
                        previous: { type: 'number', example: 0 },
                        change: { type: 'number', example: 7623426 },
                        percent_change: { type: 'number', example: 100 },
                      },
                    },
                    active_contacts: {
                      type: 'object',
                      properties: {
                        current: { type: 'number', example: 3 },
                        previous: { type: 'number', example: 1 },
                        change: { type: 'number', example: 2 },
                        percent_change: { type: 'number', example: 200 },
                      },
                    },
                    active_companies: {
                      type: 'object',
                      properties: {
                        current: { type: 'number', example: 2 },
                        previous: { type: 'number', example: 1 },
                        change: { type: 'number', example: 1 },
                        percent_change: { type: 'number', example: 100 },
                      },
                    },
                  },
                },
                charts: {
                  type: 'object',
                  properties: {
                    from: { type: 'string', format: 'date-time' },
                    to: { type: 'string', format: 'date-time' },
                    contacts: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', example: '2026-05-25' },
                          value: { type: 'number', example: 3 },
                        },
                      },
                    },
                    companies: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', example: '2026-05-25' },
                          value: { type: 'number', example: 2 },
                        },
                      },
                    },
                    deals: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', example: '2026-05-25' },
                          open_deals: { type: 'number', example: 1 },
                          revenue_forecast: { type: 'number', example: 7623426 },
                          total_deals: { type: 'number', example: 1 },
                          total_value: { type: 'number', example: 7623426 },
                        },
                      },
                    },
                    tasks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', example: '2026-05-25' },
                          value: { type: 'number', example: 4 },
                        },
                      },
                    },
                  },
                },
                pipeline_review: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      stage_id: { type: 'string' },
                      name: { type: 'string', example: 'Qualified' },
                      order: { type: 'integer', example: 2 },
                      count: { type: 'integer', example: 1 },
                      value: { type: 'number', example: 7623426 },
                      is_won: { type: 'boolean' },
                      is_lost: { type: 'boolean' },
                    },
                  },
                },
                pipeline_total: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer', example: 1 },
                    value: { type: 'number', example: 7623426 },
                  },
                },
                recent_contacts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      first_name: { type: 'string', example: 'John' },
                      last_name: { type: 'string', example: 'Doe' },
                      full_name: { type: 'string', example: 'John Doe' },
                      role_title: { type: 'string', example: 'CEO' },
                      temperature: { type: 'string', enum: ['hot', 'warm', 'cold'], example: 'hot' },
                      company: { type: 'string', nullable: true },
                      created_at: { type: 'string', format: 'date-time' },
                    },
                  },
                },
                deal_sources: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      source: { type: 'string', example: 'linkedin' },
                      count: { type: 'integer', example: 1 },
                      value: { type: 'number', example: 7623426 },
                    },
                  },
                },
                totals: { type: 'object' },
                period: { type: 'object' },
                pipeline: { type: 'object' },
                tasks: { type: 'object' },
                recent_activities: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
      },
    },
    security: [{ cookieAuth: [] }],
  },
  apis: routeDocsGlobs,
};

export const swaggerSpec = swaggerJsdoc(options);
