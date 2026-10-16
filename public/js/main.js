// Main interactive script for WacPad Landing Page with Dual Gateway (Razorpay + Dodo Payments)

document.addEventListener('DOMContentLoaded', async () => {
  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navLinks = document.getElementById('navLinks');
  if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navLinks.classList.toggle('show');
      mobileMenuBtn.setAttribute('aria-expanded', navLinks.classList.contains('show'));
    });
    document.addEventListener('click', () => {
      navLinks.classList.remove('show');
      mobileMenuBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Geolocation & regional pricing setup
  const proPrice = document.getElementById('proPrice');
  const proNote = document.getElementById('proNote');
  const checkoutBtn = document.getElementById('buyProBtn');

  let geoState = {
    isIndia: false,
    currency: 'USD',
    formattedPrice: '$14.99',
    provider: 'dodo',
  };

  try {
    const geoRes = await fetch('/api/geo');
    if (geoRes.ok) {
      geoState = await geoRes.json();
    } else {
      // Client-side fallback based on system timezone
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (timeZone.includes('Calcutta') || timeZone.includes('Kolkata')) {
        geoState = { isIndia: true, currency: 'INR', formattedPrice: '₹1,299', provider: 'razorpay' };
      }
    }
  } catch {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (timeZone.includes('Calcutta') || timeZone.includes('Kolkata')) {
      geoState = { isIndia: true, currency: 'INR', formattedPrice: '₹1,299', provider: 'razorpay' };
    }
  }

  // Update DOM if visitor is in India
  if (geoState.isIndia) {
    if (proPrice) {
      proPrice.innerHTML = `₹1,299 <span class="pricing-period">one-time lifetime</span>`;
    }
    if (checkoutBtn) {
      checkoutBtn.innerHTML = `⭐ Buy Pro Lifetime — ₹1,299 (UPI / Cards)`;
    }
    if (proNote) {
      proNote.innerHTML = `🔒 Secure checkout via Razorpay &bull; Instant UPI QR, Cards & Netbanking`;
    }
  }

  // Checkout button handler
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const originalText = checkoutBtn.innerHTML;

      if (geoState.isIndia) {
        // --- RAZORPAY CHECKOUT FLOW ---
        const customerEmail = prompt('Please enter your email to receive your WacPad Pro license key:');
        if (!customerEmail) return;

        const emailClean = customerEmail.trim();
        if (!emailClean.includes('@') || !emailClean.includes('.')) {
          alert('Please enter a valid email address.');
          return;
        }

        checkoutBtn.innerHTML = `<span>⏳ Initializing Razorpay...</span>`;
        checkoutBtn.style.opacity = '0.75';
        checkoutBtn.style.pointerEvents = 'none';

        try {
          const res = await fetch('/api/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              amount: 129900, // 1299.00 INR in paise
              currency: 'INR',
              email: emailClean,
            }),
          });

          const data = await res.json();
          if (!res.ok || !data.order_id) {
            throw new Error(data.error || 'Failed to create Razorpay order');
          }

          if (typeof Razorpay === 'undefined') {
            throw new Error('Razorpay SDK failed to load. Please check your internet connection.');
          }

          const options = {
            key: data.key_id,
            amount: data.amount,
            currency: data.currency,
            name: 'WacPad Pro',
            description: 'Lifetime License Key',
            image: '/favicon.ico',
            order_id: data.order_id,
            prefill: {
              email: emailClean,
            },
            theme: {
              color: '#3b82f6',
            },
            handler: async function (response) {
              checkoutBtn.innerHTML = `<span>🔒 Verifying Payment...</span>`;
              try {
                const verifyRes = await fetch('/api/verify-payment', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                    email: emailClean,
                  }),
                });

                const verifyData = await verifyRes.json();
                if (verifyRes.ok && verifyData.success && verifyData.redirectUrl) {
                  window.location.href = verifyData.redirectUrl;
                } else {
                  throw new Error(verifyData.error || 'Signature verification failed');
                }
              } catch (err) {
                alert('Payment verification issue: ' + err.message);
                checkoutBtn.innerHTML = originalText;
                checkoutBtn.style.opacity = '1';
                checkoutBtn.style.pointerEvents = 'auto';
              }
            },
            modal: {
              ondismiss: function () {
                checkoutBtn.innerHTML = originalText;
                checkoutBtn.style.opacity = '1';
                checkoutBtn.style.pointerEvents = 'auto';
              },
            },
          };

          const rzp = new Razorpay(options);
          rzp.on('payment.failed', function (failResp) {
            alert('Payment failed: ' + (failResp.error?.description || 'Transaction declined'));
            checkoutBtn.innerHTML = originalText;
            checkoutBtn.style.opacity = '1';
            checkoutBtn.style.pointerEvents = 'auto';
          });
          rzp.open();
        } catch (err) {
          alert('Could not start Razorpay checkout: ' + err.message);
          checkoutBtn.innerHTML = originalText;
          checkoutBtn.style.opacity = '1';
          checkoutBtn.style.pointerEvents = 'auto';
        }
      } else {
        // --- DODO PAYMENTS CHECKOUT FLOW ---
        checkoutBtn.innerHTML = `<span>⏳ Preparing Checkout...</span>`;
        checkoutBtn.style.opacity = '0.75';
        checkoutBtn.style.pointerEvents = 'none';

        try {
          const res = await fetch('/api/create-dodo-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            throw new Error(data.error || 'Failed to initialize Dodo checkout');
          }
        } catch (err) {
          alert('Could not start checkout: ' + err.message);
          checkoutBtn.innerHTML = originalText;
          checkoutBtn.style.opacity = '1';
          checkoutBtn.style.pointerEvents = 'auto';
        }
      }
    });
  }
});
