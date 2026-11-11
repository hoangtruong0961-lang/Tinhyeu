import { SampleVideo } from '../types';

export const SAMPLE_VIDEOS: SampleVideo[] = [
  {
    id: 'sample-anime',
    title: 'Short Anime Scene (Sintel Trailer)',
    description: 'Đoạn phim ngắn có sẵn phụ đề dạng văn bản phía dưới màn hình.',
    url: 'https://media.w3.org/2010/05/sintel/trailer.mp4',
    language: 'English/Mixed',
    defaultRoi: { x: 10, y: 78, width: 80, height: 18 }
  },
  {
    id: 'sample-nature',
    title: 'Phim Tài Liệu & Thuyết Minh (Oceans)',
    description: 'Video chất lượng cao có lời thoại và tiêu đề giới thiệu.',
    url: 'https://vjs.zencdn.net/v/oceans.mp4',
    language: 'English',
    defaultRoi: { x: 15, y: 80, width: 70, height: 16 }
  },
  {
    id: 'sample-tech',
    title: 'Video Công Nghệ & Demo (Big Buck Bunny)',
    description: 'Video độ phân giải HD thích hợp test trích xuất chữ OCR.',
    url: 'https://media.w3.org/2010/05/bunny/trailer.mp4',
    language: 'English',
    defaultRoi: { x: 10, y: 75, width: 80, height: 20 }
  }
];

export const SUPPORTED_LANGUAGES = [
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
];
