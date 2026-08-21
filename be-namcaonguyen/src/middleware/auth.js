export function apiKeyAuth(req, res, next) {
  const expected = process.env.API_KEY;

  if (!expected) {
    return next();
  }

  const provided = req.get('X-Api-Key');

  // if (!provided || provided !== expected) {
  //   return res.status(401).json({
  //     success: false,
  //     error: 'API key không hợp lệ',
  //   });
  // }

  return next();
}
