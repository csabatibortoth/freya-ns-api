// The OpenAPI 3 description of the API, shown by Swagger UI at /api/docs and served as JSON at
// /api/docs/openapi.json. It is written by hand: a change to a route must be made here as well.
const config = require('../config/config');
const { RECORD_TYPES } = require('../services/dnsService/dnsData');

const WRITERS = `Requires one of the roles that may change the DNS data: \`${config.dnsWriteRoles.join('`, `')}\`.`;

// ---- helpers ----------------------------------------------------------------------------------------------

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const body = (schema) => ({ required: true, content: json(schema) });
const ok = (description, schema) => ({ description, content: json(schema) });
const error = (description) => ({ description, content: json(ref('Error')) });

const ERRORS = {
    400: error('The request is malformed or a value is not valid'),
    401: error('Not signed in, or the token is expired or revoked'),
    403: error('Signed in, but not allowed to do this'),
    404: error('Not found'),
    409: error('Conflicts with what is already stored'),
};

// The answers of an operation: its own, the 401 every operation has, and the listed errors.
const responses = (own, ...errors) => ({
    ...own,
    401: ERRORS[401],
    ...Object.fromEntries(errors.map((status) => [status, ERRORS[status]])),
});

const pathParam = (name, description) => ({
    name,
    in: 'path',
    required: true,
    description,
    schema: { type: 'string', pattern: '^[0-9a-f]{24}$' },
});
const queryParam = (name, schema, description) => ({ name, in: 'query', description, schema });

const PAGING = [
    queryParam('page', { type: 'integer', minimum: 1, default: 1 }, 'The page to return'),
    queryParam('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }, 'The number of items of a page'),
];
const sortParam = (fields, fallback) =>
    queryParam(
        'sort',
        { type: 'string', enum: fields.flatMap((field) => [field, `-${field}`]), default: fallback },
        'The field to sort by, prefixed with `-` for descending'
    );
const ACTIVE = queryParam('active', { type: 'boolean' }, 'Only the active, or only the inactive ones');
const search = (where) => queryParam('q', { type: 'string' }, `Text search in ${where}`);

// The envelope every list endpoint answers with.
const page = (items) => ({
    type: 'object',
    properties: {
        items: { type: 'array', items },
        page: { type: 'integer' },
        limit: { type: 'integer' },
        total: { type: 'integer', description: 'The number of items on all pages' },
        pages: { type: 'integer' },
    },
});

const TIMESTAMPS = {
    createdAt: { type: 'string', format: 'date-time', readOnly: true },
    updatedAt: { type: 'string', format: 'date-time', readOnly: true },
};
const ID = { type: 'string', readOnly: true, example: '6af57c22d39258fa75d366fa' };
const TTL = { type: 'integer', minimum: 0, maximum: 2147483647 };

// ---- schemas ----------------------------------------------------------------------------------------------

const RECORD_DATA = {
    type: 'object',
    description:
        'The value of the record. Its fields depend on the type: `{ target }` for A, AAAA, CNAME, NS, PTR and TXT; ' +
        '`{ exchange, priority? }` for MX; `{ target, port, priority?, weight? }` for SRV. Host names must be fully qualified.',
    properties: {
        target: { type: 'string', description: 'An address, a host name or a text, by the type' },
        exchange: { type: 'string', description: 'MX: the host name of the mail server' },
        priority: { type: 'integer', minimum: 0, maximum: 65535, description: 'MX and SRV; 0 when left out' },
        weight: { type: 'integer', minimum: 0, maximum: 65535, description: 'SRV; 10 when left out' },
        port: { type: 'integer', minimum: 1, maximum: 65535, description: 'SRV' },
    },
    example: { target: '192.0.2.1' },
};

const recordInput = (name, required) => ({
    type: 'object',
    ...(required ? { required: ['name', 'type', 'data'] } : {}),
    properties: {
        name,
        ...(required ? { type: { type: 'string', enum: Object.keys(RECORD_TYPES), example: 'A' } } : {}),
        data: RECORD_DATA,
        ttl: { ...TTL, nullable: true, description: 'In seconds; `null` for the default' },
        active: { type: 'boolean', default: true },
    },
});
const ZONE_RECORD_NAME = {
    type: 'string',
    description: '`@` for the zone itself, a name relative to the zone (`www`), or a fully qualified name. The first label may be `*`.',
    example: 'www',
};
const STANDALONE_RECORD_NAME = {
    type: 'string',
    description: 'A fully qualified name. The first label may be `*`.',
    example: 'nas.home.lan',
};

const SOA_PROPERTIES = {
    host: { type: 'string', description: 'Host name of the primary name server', example: 'ns1.example.com' },
    admin: {
        type: 'string',
        description: 'Mailbox of the administrator, written as a domain name. An e-mail address is converted. Default: `hostmaster.<name>`',
        example: 'hostmaster.example.com',
    },
    serial: {
        type: 'integer',
        minimum: 0,
        maximum: 4294967295,
        description: 'Raised automatically on every change to the zone or its records',
        example: 2026111200,
    },
    refresh: { type: 'integer', default: 3600 },
    retry: { type: 'integer', default: 600 },
    expire: { type: 'integer', default: 604800 },
    ttl: { type: 'integer', default: 3600 },
};

const BLOCK_LIST_INPUT = {
    name: { type: 'string', minLength: 1, maxLength: 100, example: 'StevenBlack hosts' },
    url: {
        type: 'string',
        format: 'uri',
        description: 'An http or https address of a hosts file, a list of domains, or a list of `||domain^` adblock rules',
        example: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
    },
    description: { type: 'string', maxLength: 500 },
    active: { type: 'boolean', default: true, description: 'The domains of an inactive list are kept, but not blocked' },
};

const BLOCK_RULE_INPUT = {
    domain: { type: 'string', description: 'A fully qualified domain name', example: 'ads.example.com' },
    action: { type: 'string', enum: ['block', 'allow'], description: '`allow` takes a domain out of the block lists' },
    includeSubdomains: { type: 'boolean', default: false, description: 'Whether the rule holds for every name below the domain as well' },
    comment: { type: 'string', maxLength: 500 },
    active: { type: 'boolean', default: true },
};

const BLOCK_SETTINGS = {
    enabled: { type: 'boolean', description: 'The switch of all blocking: when false, nothing is blocked' },
    mode: {
        type: 'string',
        enum: ['NULL_IP', 'NXDOMAIN'],
        description: 'How a blocked name is answered: with `0.0.0.0` and `::`, or as a name that does not exist',
    },
};

const schemas = {
    Error: {
        type: 'object',
        properties: {
            error: { type: 'string', example: 'Validation failed' },
            details: { type: 'object', additionalProperties: { type: 'string' }, description: 'The message of each field that is not valid' },
        },
    },
    Welcome: { type: 'object', properties: { message: { type: 'string' }, version: { type: 'string' } } },
    Credentials: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
            username: { type: 'string', description: 'The username or the e-mail address', example: 'admin' },
            password: { type: 'string', format: 'password' },
        },
    },
    Login: {
        type: 'object',
        properties: {
            token: { type: 'string', description: 'Send it with every request as `Authorization: Bearer <token>`' },
            tokenType: { type: 'string', example: 'Bearer' },
            expiresIn: { type: 'string', example: '1h' },
            user: ref('User'),
        },
    },
    User: {
        type: 'object',
        properties: {
            id: ID,
            username: { type: 'string', example: 'admin' },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'user'] },
            active: { type: 'boolean' },
            lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
            ...TIMESTAMPS,
        },
    },
    UserCreate: {
        type: 'object',
        required: ['username', 'email', 'password'],
        properties: {
            username: { type: 'string', minLength: 3, maxLength: 32, pattern: '^[a-z0-9._-]+$' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
            displayName: { type: 'string', maxLength: 100 },
            role: { type: 'string', enum: ['admin', 'user'], default: 'user' },
            active: { type: 'boolean', default: true },
        },
    },
    UserUpdate: {
        type: 'object',
        description: 'Yourself: `email` and `displayName`. An admin also: `username`, `role` and `active`.',
        properties: {
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            displayName: { type: 'string' },
            role: { type: 'string', enum: ['admin', 'user'] },
            active: { type: 'boolean' },
        },
    },
    PasswordChange: {
        type: 'object',
        required: ['newPassword'],
        properties: {
            newPassword: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
            currentPassword: { type: 'string', format: 'password', description: 'Required when changing your own password' },
        },
    },
    Zone: {
        type: 'object',
        properties: {
            id: ID,
            name: { type: 'string', example: 'example.com' },
            ttl: { ...TTL, description: 'TTL of the records of the zone that do not set their own' },
            active: { type: 'boolean' },
            soa: { type: 'object', properties: SOA_PROPERTIES },
            ...TIMESTAMPS,
        },
    },
    ZoneCreate: {
        type: 'object',
        required: ['name', 'soa'],
        properties: {
            name: { type: 'string', description: 'The domain of the zone. Cannot be changed afterwards', example: 'example.com' },
            soa: { type: 'object', required: ['host'], properties: SOA_PROPERTIES },
            ttl: { ...TTL, default: 3600 },
            active: { type: 'boolean', default: true },
        },
    },
    ZoneUpdate: {
        type: 'object',
        properties: {
            soa: { type: 'object', description: 'The fields that are left out keep their value', properties: SOA_PROPERTIES },
            ttl: TTL,
            active: { type: 'boolean' },
        },
    },
    Record: {
        type: 'object',
        properties: {
            id: ID,
            zone: { type: 'string', nullable: true, description: 'The id of the zone; `null` for a standalone record' },
            name: { type: 'string', description: 'Fully qualified', example: 'www.example.com' },
            type: { type: 'string', enum: Object.keys(RECORD_TYPES) },
            ttl: { ...TTL, nullable: true },
            data: RECORD_DATA,
            active: { type: 'boolean' },
            ...TIMESTAMPS,
        },
    },
    ZoneRecordCreate: recordInput(ZONE_RECORD_NAME, true),
    ZoneRecordUpdate: recordInput(ZONE_RECORD_NAME, false),
    StandaloneRecordCreate: recordInput(STANDALONE_RECORD_NAME, true),
    StandaloneRecordUpdate: recordInput(STANDALONE_RECORD_NAME, false),
    BlockList: {
        type: 'object',
        properties: {
            id: ID,
            ...BLOCK_LIST_INPUT,
            status: {
                type: 'string',
                enum: ['pending', 'ok', 'error'],
                description: '`pending`: not downloaded yet; `ok` / `error`: the outcome of the last download',
            },
            lastError: { type: 'string', nullable: true, description: 'Why the last download failed' },
            refreshedAt: { type: 'string', format: 'date-time', nullable: true, description: 'The last successful download' },
            entryCount: { type: 'integer', description: 'The number of domains of the list' },
            refreshing: { type: 'boolean', description: 'Whether the list is being downloaded right now' },
            ...TIMESTAMPS,
        },
    },
    BlockListCreate: { type: 'object', required: ['name', 'url'], properties: BLOCK_LIST_INPUT },
    BlockListUpdate: { type: 'object', properties: BLOCK_LIST_INPUT },
    BlockRule: { type: 'object', properties: { id: ID, ...BLOCK_RULE_INPUT, ...TIMESTAMPS } },
    BlockRuleCreate: { type: 'object', required: ['domain', 'action'], properties: BLOCK_RULE_INPUT },
    BlockRuleUpdate: { type: 'object', properties: BLOCK_RULE_INPUT },
    BlockSettings: { type: 'object', properties: BLOCK_SETTINGS },
    BlockCheck: {
        type: 'object',
        properties: {
            domain: { type: 'string', example: 'ads.example.com' },
            blocked: { type: 'boolean', description: 'Always false while the blocking is switched off' },
            ...BLOCK_SETTINGS,
            rule: { allOf: [ref('BlockRule')], nullable: true, description: 'The rule that decides, if there is one' },
            lists: {
                type: 'array',
                description: 'The active block lists that hold the domain',
                items: { type: 'object', properties: { id: ID, name: { type: 'string' } } },
            },
        },
    },
};

// ---- paths ------------------------------------------------------------------------------------------------

const USER_ID = pathParam('id', 'The id of the user');
const ZONE_ID = pathParam('zoneId', 'The id of the zone');
const RECORD_ID = pathParam('recordId', 'The id of the record');
const LIST_ID = pathParam('listId', 'The id of the block list');
const RULE_ID = pathParam('ruleId', 'The id of the block rule');

const RECORD_FILTERS = [
    ...PAGING,
    queryParam('type', { type: 'string', enum: Object.keys(RECORD_TYPES) }, 'Only the records of this type'),
    queryParam('name', { type: 'string' }, 'Only the records of this name'),
    ACTIVE,
    search('the name and the target'),
    sortParam(['name', 'type', 'ttl', 'active', 'createdAt', 'updatedAt'], 'name'),
];

// The five operations of a collection of records: those of a zone, and the standalone ones.
function recordPaths(base, tag, parameters, schemaPrefix, what) {
    return {
        [base]: {
            parameters,
            get: {
                tags: [tag],
                summary: `List ${what}`,
                parameters: RECORD_FILTERS,
                responses: responses({ 200: ok('A page of records', page(ref('Record'))) }, 400, 404),
            },
            post: {
                tags: [tag],
                summary: `Create one of ${what}`,
                description: WRITERS,
                requestBody: body(ref(`${schemaPrefix}RecordCreate`)),
                responses: responses({ 201: ok('The created record', ref('Record')) }, 400, 403, 404, 409),
            },
        },
        [`${base}/{recordId}`]: {
            parameters: [...parameters, RECORD_ID],
            get: {
                tags: [tag],
                summary: `Read one of ${what}`,
                responses: responses({ 200: ok('The record', ref('Record')) }, 404),
            },
            patch: {
                tags: [tag],
                summary: `Update one of ${what}`,
                description: `${WRITERS} The type cannot be changed. The fields of \`data\` that are left out keep their value.`,
                requestBody: body(ref(`${schemaPrefix}RecordUpdate`)),
                responses: responses({ 200: ok('The updated record', ref('Record')) }, 400, 403, 404, 409),
            },
            delete: {
                tags: [tag],
                summary: `Delete one of ${what}`,
                description: WRITERS,
                responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
            },
        },
    };
}

const paths = {
    '/': {
        get: {
            tags: ['Authentication'],
            summary: 'Welcome message and version',
            responses: responses({ 200: ok('The name and the version of the server', ref('Welcome')) }),
        },
    },
    '/auth/login': {
        post: {
            tags: ['Authentication'],
            summary: 'Log in',
            description: 'The only endpoint that can be used without a token. Answers with the token for all the others.',
            security: [],
            requestBody: body(ref('Credentials')),
            responses: {
                200: ok('The token and the user', ref('Login')),
                400: ERRORS[400],
                401: error('Invalid username or password'),
            },
        },
    },
    '/auth/me': {
        get: {
            tags: ['Authentication'],
            summary: 'The current user',
            responses: responses({ 200: ok('The user of the token', ref('User')) }),
        },
    },
    '/auth/logout': {
        post: {
            tags: ['Authentication'],
            summary: 'Log out',
            description: 'Revokes every token of the current user.',
            responses: responses({ 204: { description: 'Logged out' } }),
        },
    },

    '/users': {
        get: {
            tags: ['Users'],
            summary: 'List users',
            description: 'Requires the `admin` role.',
            parameters: [
                ...PAGING,
                search('the username, the e-mail and the display name'),
                queryParam('role', { type: 'string', enum: ['admin', 'user'] }, 'Only the users of this role'),
                ACTIVE,
                queryParam('sort', { type: 'string', example: '-createdAt' }, 'The field to sort by, prefixed with `-` for descending'),
            ],
            responses: responses({ 200: ok('A page of users', page(ref('User'))) }, 400, 403),
        },
        post: {
            tags: ['Users'],
            summary: 'Create a user',
            description: 'Requires the `admin` role.',
            requestBody: body(ref('UserCreate')),
            responses: responses({ 201: ok('The created user', ref('User')) }, 400, 403, 409),
        },
    },
    '/users/{id}': {
        parameters: [USER_ID],
        get: {
            tags: ['Users'],
            summary: 'Read one user',
            description: 'Yourself, or anyone with the `admin` role.',
            responses: responses({ 200: ok('The user', ref('User')) }, 403, 404),
        },
        patch: {
            tags: ['Users'],
            summary: 'Update a user',
            description: 'Yourself, or anyone with the `admin` role. The last active admin cannot be demoted or deactivated.',
            requestBody: body(ref('UserUpdate')),
            responses: responses({ 200: ok('The updated user', ref('User')) }, 400, 403, 404, 409),
        },
        delete: {
            tags: ['Users'],
            summary: 'Delete a user',
            description: 'Requires the `admin` role. The last active admin cannot be deleted.',
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404, 409),
        },
    },
    '/users/{id}/password': {
        parameters: [USER_ID],
        put: {
            tags: ['Users'],
            summary: 'Change a password',
            description: 'Yourself, or anyone with the `admin` role. Invalidates the tokens of the user.',
            requestBody: body(ref('PasswordChange')),
            responses: responses({ 204: { description: 'Changed' } }, 400, 403, 404),
        },
    },

    '/zones': {
        get: {
            tags: ['Zones'],
            summary: 'List zones',
            parameters: [
                ...PAGING,
                search('the name'),
                ACTIVE,
                sortParam(['name', 'active', 'ttl', 'createdAt', 'updatedAt'], 'name'),
            ],
            responses: responses({ 200: ok('A page of zones', page(ref('Zone'))) }, 400),
        },
        post: {
            tags: ['Zones'],
            summary: 'Create a zone',
            description: WRITERS,
            requestBody: body(ref('ZoneCreate')),
            responses: responses({ 201: ok('The created zone', ref('Zone')) }, 400, 403, 409),
        },
    },
    '/zones/{zoneId}': {
        parameters: [ZONE_ID],
        get: {
            tags: ['Zones'],
            summary: 'Read one zone',
            responses: responses({ 200: ok('The zone', ref('Zone')) }, 404),
        },
        patch: {
            tags: ['Zones'],
            summary: 'Update a zone',
            description: `${WRITERS} A zone cannot be renamed.`,
            requestBody: body(ref('ZoneUpdate')),
            responses: responses({ 200: ok('The updated zone', ref('Zone')) }, 400, 403, 404),
        },
        delete: {
            tags: ['Zones'],
            summary: 'Delete a zone and all of its records',
            description: WRITERS,
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
        },
    },
    ...recordPaths('/zones/{zoneId}/records', 'Zone records', [ZONE_ID], 'Zone', 'the records of a zone'),
    ...recordPaths('/records', 'Standalone records', [], 'Standalone', 'the standalone records'),

    '/blocking/settings': {
        get: {
            tags: ['Blocking'],
            summary: 'Read the settings of the blocking',
            responses: responses({ 200: ok('The settings', ref('BlockSettings')) }),
        },
        patch: {
            tags: ['Blocking'],
            summary: 'Switch the blocking on or off, or change how a blocked name is answered',
            description: WRITERS,
            requestBody: body(ref('BlockSettings')),
            responses: responses({ 200: ok('The updated settings', ref('BlockSettings')) }, 400, 403),
        },
    },
    '/blocking/check': {
        get: {
            tags: ['Blocking'],
            summary: 'Tell whether a domain is blocked, and why',
            description:
                'A rule wins over the block lists: the rule of the domain itself, or else of the nearest domain above it ' +
                'that includes its subdomains. Without a rule, the domain is blocked when an active list holds exactly this name.',
            parameters: [{ ...queryParam('domain', { type: 'string' }, 'The domain to check'), required: true, example: 'ads.example.com' }],
            responses: responses({ 200: ok('The decision', ref('BlockCheck')) }, 400),
        },
    },
    '/blocking/lists': {
        get: {
            tags: ['Block lists'],
            summary: 'List block lists',
            parameters: [
                ...PAGING,
                search('the name, the url and the description'),
                ACTIVE,
                queryParam('status', { type: 'string', enum: ['pending', 'ok', 'error'] }, 'Only the lists of this status'),
                sortParam(['name', 'url', 'active', 'status', 'entryCount', 'refreshedAt', 'createdAt', 'updatedAt'], 'name'),
            ],
            responses: responses({ 200: ok('A page of block lists', page(ref('BlockList'))) }, 400),
        },
        post: {
            tags: ['Block lists'],
            summary: 'Add a block list',
            description: `${WRITERS} Answers at once with the status \`pending\`; the list is downloaded in the background.`,
            requestBody: body(ref('BlockListCreate')),
            responses: responses({ 201: ok('The created block list', ref('BlockList')) }, 400, 403, 409),
        },
    },
    '/blocking/lists/refresh': {
        post: {
            tags: ['Block lists'],
            summary: 'Download every active block list again',
            description: `${WRITERS} Answers at once; the lists are downloaded in the background, one after the other.`,
            responses: responses(
                {
                    202: ok('The number of lists whose download was started', {
                        type: 'object',
                        properties: { started: { type: 'integer' } },
                    }),
                },
                403
            ),
        },
    },
    '/blocking/lists/{listId}': {
        parameters: [LIST_ID],
        get: {
            tags: ['Block lists'],
            summary: 'Read one block list',
            responses: responses({ 200: ok('The block list', ref('BlockList')) }, 404),
        },
        patch: {
            tags: ['Block lists'],
            summary: 'Update a block list',
            description: `${WRITERS} A new \`url\` is downloaded in the background right away.`,
            requestBody: body(ref('BlockListUpdate')),
            responses: responses({ 200: ok('The updated block list', ref('BlockList')) }, 400, 403, 404, 409),
        },
        delete: {
            tags: ['Block lists'],
            summary: 'Delete a block list and all of its domains',
            description: WRITERS,
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
        },
    },
    '/blocking/lists/{listId}/refresh': {
        parameters: [LIST_ID],
        post: {
            tags: ['Block lists'],
            summary: 'Download a block list again',
            description:
                `${WRITERS} Answers when the download is done. The answer is 200 for a failed download as well: ` +
                'its outcome is the `status` of the list, with the reason in `lastError`. A failed download keeps the domains the list had.',
            responses: responses({ 200: ok('The block list after the download', ref('BlockList')) }, 403, 404),
        },
    },
    '/blocking/lists/{listId}/entries': {
        parameters: [LIST_ID],
        get: {
            tags: ['Block lists'],
            summary: 'List the domains of a block list',
            parameters: [...PAGING, queryParam('q', { type: 'string' }, 'A part of the domain')],
            responses: responses({ 200: ok('A page of domains', page({ type: 'string', example: 'ads.example.com' })) }, 404),
        },
    },
    '/blocking/rules': {
        get: {
            tags: ['Block rules'],
            summary: 'List block rules',
            parameters: [
                ...PAGING,
                search('the domain and the comment'),
                queryParam('action', { type: 'string', enum: ['block', 'allow'] }, 'Only the rules of this action'),
                ACTIVE,
                sortParam(['domain', 'action', 'active', 'createdAt', 'updatedAt'], 'domain'),
            ],
            responses: responses({ 200: ok('A page of block rules', page(ref('BlockRule'))) }, 400),
        },
        post: {
            tags: ['Block rules'],
            summary: 'Block or allow a domain by hand',
            description: WRITERS,
            requestBody: body(ref('BlockRuleCreate')),
            responses: responses({ 201: ok('The created block rule', ref('BlockRule')) }, 400, 403, 409),
        },
    },
    '/blocking/rules/{ruleId}': {
        parameters: [RULE_ID],
        get: {
            tags: ['Block rules'],
            summary: 'Read one block rule',
            responses: responses({ 200: ok('The block rule', ref('BlockRule')) }, 404),
        },
        patch: {
            tags: ['Block rules'],
            summary: 'Update a block rule',
            description: WRITERS,
            requestBody: body(ref('BlockRuleUpdate')),
            responses: responses({ 200: ok('The updated block rule', ref('BlockRule')) }, 400, 403, 404, 409),
        },
        delete: {
            tags: ['Block rules'],
            summary: 'Delete a block rule',
            description: WRITERS,
            responses: responses({ 204: { description: 'Deleted' } }, 403, 404),
        },
    },
};

module.exports = {
    openapi: '3.0.3',
    info: {
        title: 'Freya NS API',
        version: config.version,
        description:
            'Management API of the Freya DNS server: users, zones, records, and the blocking of domains.\n\n' +
            'Every endpoint except `POST /auth/login` requires signing in. Log in, press **Authorize**, and paste the `token` of the answer.',
        license: { name: 'MIT' },
    },
    servers: [{ url: '/api' }],
    tags: [
        { name: 'Authentication' },
        { name: 'Users' },
        { name: 'Zones' },
        { name: 'Zone records', description: 'The records of a zone' },
        { name: 'Standalone records', description: 'Records that belong to no zone' },
        { name: 'Blocking', description: 'The settings of the blocking, and the check of a domain' },
        { name: 'Block lists', description: 'Lists of domains to block, downloaded from a URL' },
        { name: 'Block rules', description: 'Domains blocked or allowed by hand; they win over the block lists' },
    ],
    // Applies to every operation that does not say otherwise.
    security: [{ bearerAuth: [] }],
    components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        schemas,
    },
    paths,
};
