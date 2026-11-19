-- 그림 파일: 비공개 버킷. 경로는 "{user_id}/{memo_images.id}"예요.
-- 올리기는 upload-image 함수(관리자 키)만 해요. 한 장 5MB, 한 사람 50MB 한도를 거기서 확인해요.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', false, 5 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

-- 자기 폴더의 그림만 볼 수 있어요(서명 주소 만들기 포함).
create policy "내 그림 파일 보기" on storage.objects for select to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = (select auth.uid())::text);
