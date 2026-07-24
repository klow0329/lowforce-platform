// Converts a number to the "RINGGIT MALAYSIA ... AND CENTS ... ONLY." wording
// used on printed tax invoices — matches the format of EXPOCO's real
// invoices (e.g. 19,368.85 -> "RINGGIT MALAYSIA NINETEEN THOUSAND THREE
// HUNDRED AND SIXTY EIGHT AND CENTS EIGHTY FIVE ONLY.").
const ONES = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

function threeDigitsToWords(n) {
  let words = '';
  if (n >= 100) {
    words += `${ONES[Math.floor(n / 100)]} HUNDRED`;
    n %= 100;
    if (n > 0) words += ' AND ';
  }
  if (n >= 20) {
    words += TENS[Math.floor(n / 10)];
    if (n % 10 > 0) words += ` ${ONES[n % 10]}`;
  } else if (n > 0) {
    words += ONES[n];
  }
  return words.trim();
}

function integerToWords(n) {
  if (n === 0) return 'ZERO';
  const scales = ['', 'THOUSAND', 'MILLION', 'BILLION'];
  const groups = [];
  let i = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk > 0) groups.unshift(`${threeDigitsToWords(chunk)}${scales[i] ? ' ' + scales[i] : ''}`);
    n = Math.floor(n / 1000);
    i++;
  }
  return groups.join(' ');
}

const CURRENCY_LABELS = { MYR: 'RINGGIT MALAYSIA', USD: 'US DOLLARS' };

export function amountInWords(amount, currency = 'MYR') {
  const rounded = Math.round(Number(amount) * 100) / 100;
  const whole = Math.floor(rounded);
  const cents = Math.round((rounded - whole) * 100);
  let text = `${CURRENCY_LABELS[currency] || currency} ${integerToWords(whole)}`;
  if (cents > 0) text += ` AND CENTS ${integerToWords(cents)}`;
  return `${text} ONLY.`;
}
