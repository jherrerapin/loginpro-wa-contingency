export const RECRUITMENT_EXTRACTION_SCHEMA = {
  name: 'recruitment_turn_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      turnType: { type: 'string', enum: ['GREETING', 'PROVIDE_DATA', 'ASK_QUESTION', 'CONFIRMATION', 'MEDIA', 'OTHER'] },
      fields: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: ['string', 'null'] },
          age: { type: ['integer', 'null'] },
          documentType: { type: ['string', 'null'] },
          documentNumber: { type: ['string', 'null'] },
          gender: { type: ['string', 'null'], enum: ['MALE', 'FEMALE', 'OTHER', 'UNKNOWN', null] },
          locality: { type: ['string', 'null'] },
          neighborhood: { type: ['string', 'null'] },
          transportMode: { type: ['string', 'null'] },
          medicalRestrictions: { type: ['string', 'null'] },
          experienceInfo: { type: ['string', 'null'] }
        },
        required: ['fullName', 'age', 'documentType', 'documentNumber', 'gender', 'locality', 'neighborhood', 'transportMode', 'medicalRestrictions', 'experienceInfo']
      },
      fieldEvidence: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          properties: {
            snippet: { type: ['string', 'null'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            source: { type: 'string' }
          },
          required: ['snippet', 'confidence', 'source']
        }
      },
      conflicts: { type: 'array', items: { type: 'string' } },
      attachment: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mentioned: { type: 'boolean' },
          kindHint: { type: ['string', 'null'], enum: ['CV', 'ID_DOC', 'OTHER', null] }
        },
        required: ['mentioned', 'kindHint']
      },
      replyIntent: { type: 'string' }
    },
    required: ['turnType', 'fields', 'fieldEvidence', 'conflicts', 'attachment', 'replyIntent']
  }
};
