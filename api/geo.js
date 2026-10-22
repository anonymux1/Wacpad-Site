/**
 * Geolocation detection endpoint returning visitor country and regional payment preference.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  const queryOverride = (req.query?.geo || req.query?.country || '').toUpperCase();
  const countryHeader = queryOverride || req.headers?.['cf-ipcountry'] || req.headers?.['x-country-code'] || '';
  const country = countryHeader.toUpperCase();
  const isIndia = country === 'IN';

  return res.status(200).json({
    country: country || 'US',
    isIndia,
    currency: isIndia ? 'INR' : 'USD',
    amount: isIndia ? 899 : 9.99,
    formattedPrice: isIndia ? '₹899' : '$9.99',
    provider: isIndia ? 'razorpay' : 'dodo',
  });
}
