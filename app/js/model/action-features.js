export function actionFeatures(model) { return model.data.progression?.actionFeatures || []; }
export function linkedFeature(model, card) {
  return card.source?.startsWith('class-feature:') ? actionFeatures(model).find(f => `class-feature:${f.id}` === card.source) : null;
}
// Layout and action type belong to the session arrangement. Everything else
// on a class-feature shortcut follows the definition in Progression.
export function effectiveAction(model, card) {
  const feature = linkedFeature(model, card);
  return feature ? {...card, ...feature, id:card.id, source:card.source,
    type:card.type || feature.type, groupId:card.groupId, width:card.width,
    kind:card.kind} : card;
}
