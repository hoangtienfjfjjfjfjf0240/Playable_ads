'use client';

import { useParams } from 'next/navigation';
import { PlayableStudio } from '../../../../components/PlayableStudio';

export default function AppStudioV2Page() {
  const params = useParams<{ appId: string }>();
  const appId = Array.isArray(params?.appId) ? params.appId[0] : params?.appId;

  if (!appId) return null;
  return <PlayableStudio appId={appId} />;
}
