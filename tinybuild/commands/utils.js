export const exists = () => true
export const json = (o) => {if(/^[[\]{"'`]/.test(o)) JSON.parse(o); else return o;}
export const uri = (o) => {if(/^[[\]{"'`]/.test(o)) JSON.parse(getURIComponent(o)); else return getURIComponent(o);}
