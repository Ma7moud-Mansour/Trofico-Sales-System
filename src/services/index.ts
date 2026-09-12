import { httpServices, auth } from "./http";
import {
  services as mock,
  subscribe as mockSubscribe,
  demo,
} from "./mock/adapter";
export const mockEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_DATA_MODE === "mock";
export const services = {
  ...(mockEnabled ? mock : httpServices),
  session: {
    accounts: () => (mockEnabled ? mock.session.accounts() : []),
    current: async () => {
      if (mockEnabled) return mock.session.current();
      try {
        return await auth.me();
      } catch (e) {
        if ((e as { code?: string }).code === "UNAUTHENTICATED") return null;
        throw e;
      }
    },
    login: async (id: string, password = "") =>
      mockEnabled ? mock.session.login(id) : auth.login(id, password),
    logout: async () => (mockEnabled ? mock.session.logout() : auth.logout()),
  },
};
export const subscribe = (fn: () => void) =>
  mockEnabled ? mockSubscribe(fn) : () => {};
export { demo };
