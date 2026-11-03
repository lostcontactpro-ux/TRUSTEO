import {it,expect} from 'vitest';import {summarizeReviews} from './statistics';
it('keeps empty metrics distinct from zero',()=>{expect(summarizeReviews([]).averageRating).toBeNull();expect(summarizeReviews([]).reviewCount).toBe(0)});
it('compares 30-day periods and response delays',()=>{const now=new Date('2026-11-02T12:00:00Z');const old=new Date('2026-09-20');const fresh=new Date('2026-10-25');const s=summarizeReviews([{rating:2,publishedAt:old,repliedAt:null,locationId:'a'},{rating:4,publishedAt:fresh,repliedAt:new Date(fresh.getTime()+7200000),locationId:'a'}],now);expect(s.averageRating).toBe(3);expect(s.ratingChange).toBe(2);expect(s.averageResponseHours).toBe(2);expect(s.pendingCount).toBe(1)});

it('does not count imported existing replies as pending or invent response delays',()=>{const s=summarizeReviews([{rating:4,publishedAt:new Date(),repliedAt:null,locationId:'a',status:'replied'}]);expect(s.pendingCount).toBe(0);expect(s.averageResponseHours).toBeNull()});
