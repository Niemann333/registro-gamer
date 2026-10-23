// Sem servidor de metadados: responde vazio
const axios = { get: async () => ({ data: {} }), post: async () => ({ data: {} }) };
export default axios;
