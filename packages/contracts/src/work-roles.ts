/**
 * Work roles and question scopes, mirrored from the Teams server (src/domain/roles.ts). The server
 * routes each review to a member who holds the task's role and each question to the task's
 * reviewer or the project's lead for that role. A person can hold several roles.
 */

/** What a person does on a team. */
export const workRoles = ['product_manager', 'be_engineer', 'fe_engineer'] as const;

/** One work role. */
export type WorkRole = (typeof workRoles)[number];

/**
 * Whether a question is about the task it came from (its reviewer answers) or a wider product or
 * cross-team question (the project's lead for the role answers).
 */
export const questionScopes = ['task', 'general'] as const;

/** One question scope. */
export type QuestionScope = (typeof questionScopes)[number];
