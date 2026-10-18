const swaggerOptions = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'E-Commerce Demo API',
      version: '1.0.0',
      description: '花卉電商網站 REST API'
    },
    servers: [{ url: 'http://localhost:3001' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        sessionId: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Session-Id'
        }
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            data: { type: 'object', nullable: true, example: null },
            error: { type: 'string', example: 'VALIDATION_ERROR' },
            message: { type: 'string' }
          }
        }
      },
      responses: {
        Unauthorized: {
          description: '缺少或無效的認證資訊（UNAUTHORIZED）',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
        },
        Forbidden: {
          description: '權限不足（FORBIDDEN）',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
        },
        InternalError: {
          description: '伺服器內部錯誤（INTERNAL_ERROR）',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
        }
      }
    }
  },
  apis: ['./src/routes/*.js']
};

module.exports = swaggerOptions;
