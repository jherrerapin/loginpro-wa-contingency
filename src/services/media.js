import axios from 'axios';

export async function fetchMediaMetadata(mediaId) {
  const url = `https://graph.facebook.com/v23.0/${mediaId}`;
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    timeout: 15000
  });
  return response.data;
}

export async function downloadMedia(downloadUrl) {
  const response = await axios.get(downloadUrl, {
    headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}` },
    responseType: 'arraybuffer',
    timeout: 30000
  });
  return Buffer.from(response.data);
}

export async function uploadMedia(buffer, mimeType, filename = 'forwarded-image.jpg') {
  const url = `https://graph.facebook.com/v23.0/${process.env.META_PHONE_NUMBER_ID}/media`;
  const form = new FormData();
  const mediaType = mimeType || 'image/jpeg';

  form.append('messaging_product', 'whatsapp');
  form.append('type', mediaType);
  form.append('file', new Blob([buffer], { type: mediaType }), filename);

  const response = await axios.post(url, form, {
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`
    },
    timeout: 30000
  });

  return response.data?.id || null;
}
