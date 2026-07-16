import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

const baseURL = process.env.NEXT_PUBLIC_SERVER_URL;

if (!baseURL) {
  throw new Error('NEXT_PUBLIC_SERVER_URL is required');
}

type RetryConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

type RefreshResponse = {
  accessToken: string;
};

const refreshClient = axios.create({
  baseURL,
  withCredentials: true,
});

const api: AxiosInstance = axios.create({
  baseURL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const accessToken = window.localStorage.getItem('accessToken');
    if (accessToken) {
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryConfig | undefined;

    if (!originalRequest || error.response?.status !== 401) {
      return Promise.reject(error);
    }

    // Do not try to refresh for auth endpoints (login, register, refresh, password flows)
    const skipRefreshFor = [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
      '/auth/password',
      '/auth/register/request-otp',
      '/auth/register/verify-otp',
      '/auth/password/request-otp',
      '/auth/password/reset',
    ];

    const reqUrl = originalRequest.url ?? '';
    if (skipRefreshFor.some((p) => reqUrl.includes(p))) {
      return Promise.reject(error);
    }

    if (originalRequest._retry) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      if (typeof window === 'undefined') {
        return Promise.reject(error);
      }

      // Send the refresh token in the body, not only via cookie. In production
      // the SPA (Vercel) and API (Render) are on different domains, so the
      // httpOnly refresh cookie is a THIRD-PARTY cookie that Safari/iOS block and
      // Chrome is phasing out — it often never reaches /auth/refresh. The body
      // token keeps refresh working cross-domain; the cookie still serves as a
      // fallback for same-site deployments.
      const storedRefreshToken = window.localStorage.getItem('refreshToken');
      const { data } = await refreshClient.post<RefreshResponse>(
        '/auth/refresh',
        storedRefreshToken ? { refreshToken: storedRefreshToken } : {},
      );

      window.localStorage.setItem('accessToken', data.accessToken);
      originalRequest.headers = originalRequest.headers ?? {};
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;

      return api(originalRequest);
    } catch (refreshError) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('accessToken');
        window.localStorage.removeItem('refreshToken');
        window.location.href = '/login';
      }
      return Promise.reject(refreshError);
    }
  }
);

export default api;
