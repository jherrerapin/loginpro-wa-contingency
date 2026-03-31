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
