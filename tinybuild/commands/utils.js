export const existence = () => true
export const json = (o) => JSON.parse(o)
export const uri = (o) => JSON.parse(getURIComponent(o))
