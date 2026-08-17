import { config } from './config.js'

/**
 * Spec volontairement descriptive: elle est destinee a etre chargee telle quelle
 * comme definition d'outil par un agent.
 */
export const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'handoff — demande de secret',
    version: '0.1.0',
    description:
      "Permet a un agent de reclamer un secret (cle API, token, mot de passe) a son humain " +
      "sans que la valeur transite par le fil de conversation. L'agent cree une demande, " +
      "transmet l'URL a son humain, sonde jusqu'a ce qu'elle soit remplie, puis la revele une fois.",
  },
  servers: [{ url: config.baseUrl }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Cle API du service.' },
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
              "pending: en attente de l'humain. filled: pret a etre revele. " +
              'revealed: deja lu. expired / cancelled: termine.',
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
              'Nombre d’ouvertures de la page. Superieur a 1 = le lien a ete vu plusieurs fois, ' +
              'a signaler a l’humain.',
          },
          first_opened_at: { type: ['string', 'null'], format: 'date-time' },
          filled_at: { type: ['string', 'null'], format: 'date-time' },
          filled_from_ip_hash: {
            type: ['string', 'null'],
            description: 'Empreinte salee de l’IP de remplissage. Jamais l’IP en clair.',
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
        summary: 'Creer une demande de secret et obtenir le lien a envoyer a l’humain',
        description:
          'Renvoie une url a transmettre a l’humain, plus poll_token et encryption_key ' +
          'que l’agent doit conserver: les deux sont necessaires pour lire le secret. ' +
          'Ne jamais afficher poll_token ni encryption_key a l’utilisateur.',
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
                    description: 'Qui demande, tel que l’humain le verra. Ex: "Assistant Telegram".',
                  },
                  label: {
                    type: 'string',
                    maxLength: 120,
                    description: 'Ce qui est demande. Ex: "Cle API Gmail".',
                  },
                  purpose: {
                    type: 'string',
                    maxLength: 400,
                    description: 'Pourquoi. Affiche a l’humain pour qu’il puisse juger.',
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
                    description: 'Si vrai, le secret est detruit des la premiere lecture.',
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Demande creee',
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
          '400': { description: 'Requete invalide' },
          '401': { description: 'Cle API manquante ou inconnue' },
          '429': { description: 'Trop de demandes' },
        },
      },
    },
    '/v1/requests/{id}': {
      get: {
        operationId: 'getSecretRequest',
        summary: 'Consulter l’etat d’une demande (ne renvoie jamais le secret)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'X-Poll-Token',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'Le poll_token recu a la creation.',
          },
        ],
        responses: {
          '200': {
            description: 'Etat courant',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Request' } } },
          },
          '403': { description: 'poll_token invalide' },
          '404': { description: 'Introuvable' },
        },
      },
      delete: {
        operationId: 'cancelSecretRequest',
        summary: 'Annuler une demande et effacer son contenu',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'X-Poll-Token', in: 'header', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Annulee' }, '404': { description: 'Introuvable' } },
      },
    },
    '/v1/requests/{id}/reveal': {
      post: {
        operationId: 'revealSecret',
        summary: 'Lire le secret une fois la demande remplie',
        description:
          'A n’appeler que lorsque status vaut "filled". Par defaut le secret est detruit ' +
          'immediatement apres cette lecture: ne l’appelle qu’au moment ou tu vas t’en servir.',
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
            description: 'Secret en clair',
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
          '409': { description: 'La demande n’est pas encore remplie' },
        },
      },
    },
    '/healthz': {
      get: { operationId: 'health', summary: 'Sonde de sante', security: [], responses: { '200': { description: 'ok' } } },
    },
  },
} as const
