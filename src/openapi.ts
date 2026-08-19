import { config } from './config.js'

/**
 * Deliberately verbose: this spec is meant to be loaded as-is as a tool
 * definition by an agent, so the descriptions are written for the model.
 */
export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'chut — secret request',
    version: '0.1.0',
    description:
      'Lets an agent request a secret (API key, token, password) from its human without ' +
      'the value ever travelling through the conversation. The agent creates a request, ' +
      'hands the URL to its human, polls until it is filled, then reveals it once.',
  },
  servers: [{ url: config.baseUrl }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Service API key.' },
    },
    schemas: {
      Request: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'filled', 'revealed', 'expired', 'cancelled'],
            description:
              'pending: waiting on the human. filled: ready to be revealed. ' +
              'revealed: already read. expired / cancelled: finished.',
          },
          requester: { type: 'string' },
          label: { type: 'string' },
          purpose: { type: ['string', 'null'] },
          url: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          expires_at: { type: 'string', format: 'date-time' },
          expires_in_seconds: { type: 'integer' },
          burn_on_reveal: { type: 'boolean' },
          opened_count: {
            type: 'integer',
            description:
              'How many times the page was opened. Greater than 1 means the link was seen ' +
              'several times — worth flagging to the human.',
          },
          first_opened_at: { type: ['string', 'null'], format: 'date-time' },
          filled_at: { type: ['string', 'null'], format: 'date-time' },
          filled_from_ip_hash: {
            type: ['string', 'null'],
            description: 'Salted fingerprint of the filling IP. Never the raw IP.',
          },
          filled_user_agent: { type: ['string', 'null'] },
          revealed_at: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
  paths: {
    '/v1/requests': {
      post: {
        operationId: 'createSecretRequest',
        summary: 'Create a secret request and get the link to send to the human',
        description:
          'Returns a url to hand to the human, plus poll_token and encryption_key that the ' +
          'agent must keep: both are required to read the secret. Never show poll_token or ' +
          'encryption_key to the user.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['requester', 'label'],
                properties: {
                  requester: {
                    type: 'string',
                    maxLength: 80,
                    description: 'Who is asking, as the human will see it. E.g. "Telegram Assistant".',
                  },
                  label: {
                    type: 'string',
                    maxLength: 120,
                    description: 'What is being asked for. E.g. "Gmail API key".',
                  },
                  purpose: {
                    type: 'string',
                    maxLength: 400,
                    description: 'Why. Shown to the human so they can judge for themselves.',
                  },
                  ttl_seconds: {
                    type: 'integer',
                    minimum: 30,
                    maximum: config.maxTtl,
                    default: config.defaultTtl,
                  },
                  burn_on_reveal: {
                    type: 'boolean',
                    default: true,
                    description:
                      'If true, the secret is destroyed on first read. Must be a real ' +
                      'boolean: the string "true" or the number 1 are rejected rather ' +
                      'than silently disabling single-use.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Request created',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Request' },
                    {
                      type: 'object',
                      properties: {
                        poll_token: { type: 'string' },
                        encryption_key: { type: 'string' },
                      },
                    },
                  ],
                },
              },
            },
          },
          '400': { description: 'Invalid request' },
          '401': { description: 'Missing or unknown API key' },
          '429': { description: 'Too many requests' },
        },
      },
    },
    '/v1/requests/{id}': {
      get: {
        operationId: 'getSecretRequest',
        summary: 'Check the state of a request (never returns the secret)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'X-Poll-Token',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description:
              'The poll_token received on creation. It must travel in this header, ' +
              'never in the query string: URLs end up in proxy and CDN access logs.',
          },
        ],
        responses: {
          '200': {
            description: 'Current state',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Request' } } },
          },
          '403': { description: 'Invalid poll_token' },
          '404': { description: 'Not found' },
        },
      },
      delete: {
        operationId: 'cancelSecretRequest',
        summary: 'Cancel a request and wipe its contents',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'X-Poll-Token', in: 'header', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Cancelled' }, '404': { description: 'Not found' } },
      },
    },
    '/v1/requests/{id}/reveal': {
      post: {
        operationId: 'revealSecret',
        summary: 'Read the secret once the request has been filled',
        description:
          'Only call this when status is "filled". By default the secret is destroyed ' +
          'immediately after this read: call it only at the moment you are going to use it.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['poll_token', 'encryption_key'],
                properties: {
                  poll_token: { type: 'string' },
                  encryption_key: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Plaintext secret',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    label: { type: 'string' },
                    secret: { type: 'string' },
                    burned: { type: 'boolean' },
                  },
                },
              },
            },
          },
          '409': { description: 'The request is not filled yet' },
        },
      },
    },
    '/healthz': {
      get: {
        operationId: 'health',
        summary: 'Health probe',
        security: [],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
} as const
