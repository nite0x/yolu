export const conversationPathKey = (path: string) => {
 let value = String(path || '').replace(/\\/g, '/');
 if (value !== '/') value = value.replace(/\/+$/, '');
 if (/^[a-z]:/i.test(value) || value.startsWith('//')) value = value.toLowerCase();
 return value;
};
export const conversationEnvironmentKey = (environment: string,id: string) => environment === 'local' ? id : JSON.stringify([environment,id]);
