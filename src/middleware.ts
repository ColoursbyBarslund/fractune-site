import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(({ request, url, rewrite }, next) => {
  const host = request.headers.get('host') || '';

  // If the request is for sites.fractune.dk, rewrite to /sites/* routes
  if (host.startsWith('sites.')) {
    // Don't rewrite API calls or if already on /sites path
    if (url.pathname.startsWith('/sites') || url.pathname.startsWith('/api')) {
      return next();
    }

    // Rewrite root and all other paths to /sites/*
    const newPath = '/sites' + url.pathname;
    return rewrite(newPath);
  }

  return next();
});
