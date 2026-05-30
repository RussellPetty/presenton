import { getToken } from "@/utils/clerkToken";

export const getHeader = async () => {
  const token = await getToken();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const getHeaderForFormData = async () => {
  const token = await getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};
