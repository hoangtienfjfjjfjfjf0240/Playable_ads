'use client';

import { useParams } from 'next/navigation';
import { PlayableCloneStudio } from '../../../../../components/PlayableCloneStudio';

export default function ClonePlayableV2Page() {
  const params = useParams<{ appId: string }>();
  const appId = Array.isArray(params?.appId) ? params.appId[0] : params?.appId;

  if (!appId) return null;
  return <PlayableCloneStudio appId={appId} />;
}
