export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { name, email, amount, message } = req.body;

  if (!name || !email || !amount || amount < 1) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const orderId = 'tip-' + Date.now();

  // Auto-detect base URL from request
  const origin = req.headers.origin || req.headers.host;
  const baseUrl = origin.startsWith('http') ? origin : 'https://' + origin;

  try {
    const cfRes = await fetch('https://sandbox.cashfree.com/pg/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': '2023-08-01',
        'x-client-id':     process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount,
        order_currency: 'INR',
        customer_details: {
          customer_id:    'cust-' + Date.now(),
          customer_name:  name,
          customer_email: email,
          customer_phone: '9999999999',
        },
        order_meta: {
          notify_url: process.env.WEBHOOK_URL,
          return_url: `${baseUrl}/thankyou?order_id=${orderId}`,
        },
        order_tags: {
          message: message || '',
        }
      })
    });

    const order = await cfRes.json();

    console.log('CF Status:', cfRes.status);
    console.log('CF Response:', JSON.stringify(order));

    if (!cfRes.ok) {
      return res.status(500).json({
        error: 'Failed to create order',
        cf_status: cfRes.status,
        cf_response: order
      });
    }

    return res.status(200).json({
      order_id: order.order_id,
      payment_session_id: order.payment_session_id,
    });

  } catch (err) {
    console.error('Exception:', err.message);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}
