INSERT INTO locations(id,name) VALUES(1,'420 E 6th St, Suite 205, Odessa, TX 79761') ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO providers(id,name) VALUES(1,'Dr. Harika Thummala, MD') ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO appointment_types(id,name,duration_minutes) VALUES(1,'Internal Medicine appointment',30) ON DUPLICATE KEY UPDATE name=VALUES(name),duration_minutes=30;
UPDATE booking_options SET enabled=0;
INSERT INTO booking_options(location_id,provider_id,type_id,enabled,verified,is_demo) VALUES(1,1,1,1,1,0) ON DUPLICATE KEY UPDATE enabled=1,verified=1,is_demo=0;
DELETE FROM weekly_windows WHERE location_id=1 AND provider_id=1;
INSERT INTO weekly_windows(location_id,provider_id,weekday,open_time,close_time) VALUES
(1,1,1,'08:30','16:30'),(1,1,2,'08:30','16:30'),(1,1,3,'08:30','16:30'),(1,1,4,'08:30','16:30'),(1,1,5,'08:30','12:30');
