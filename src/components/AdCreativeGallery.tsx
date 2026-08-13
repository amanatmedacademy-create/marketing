import AdCreativeGalleryBase from './AdCreativeGalleryBase';
import CreativeRecommendationsPanel from './CreativeRecommendationsPanel';

export default function AdCreativeGallery() {
  return <div style={{display:'grid',gap:14}}>
    <CreativeRecommendationsPanel />
    <AdCreativeGalleryBase />
  </div>;
}
