export function canManageBusinessCard(actor: {sub:string;role:string}, ownerId: string): boolean {
  return actor.role === 'master' || actor.sub === ownerId;
}
export function canDeleteBusinessCard(actor: {role:string}): boolean {
  return actor.role === 'master';
}
